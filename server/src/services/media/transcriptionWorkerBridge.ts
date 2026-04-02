import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { env } from '../../config/env.js';
import { UpstreamError } from '../../lib/errors.js';

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  vtt: string;
  language: string;
  languageProbability?: number;
  durationSeconds?: number;
  model: string;
  profile?: 'fast' | 'quality' | 'long_form';
  segments: TranscriptionSegment[];
}

type WorkerRequest = {
  requestId: string;
  filePath: string;
  language?: string;
  maxVttBytes?: number;
  profile?: 'fast' | 'quality' | 'long_form';
};

type WorkerResponse =
  | {
      requestId: string;
      ok: true;
      result: TranscriptionResult;
    }
  | {
      requestId: string;
      ok: false;
      error: string;
      traceback?: string;
    };

type PendingRequest = {
  resolve: (value: TranscriptionResult) => void;
  reject: (reason?: unknown) => void;
  timeoutId: NodeJS.Timeout;
};

const DEFAULT_WORKER_PATH = fileURLToPath(new URL('../../../scripts/transcription_worker.py', import.meta.url));

function maybeUnref(handle: unknown): void {
  if (!handle || typeof handle !== 'object') return;
  const candidate = handle as { unref?: () => void };
  candidate.unref?.();
}

function createWorkerError(message: string, details?: unknown): UpstreamError {
  return new UpstreamError(message, details, 502);
}

class TranscriptionWorkerBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingRequest>();
  private stderrBuffer: string[] = [];
  private requestSequence = 0;

  constructor() {
    process.once('exit', () => {
      this.child?.kill();
      this.child = null;
    });
  }

  private getWorkerPath(): string {
    return env.TRANSCRIPTION_WORKER_PATH || DEFAULT_WORKER_PATH;
  }

  private startWorker(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;

    const child = spawn(env.TRANSCRIPTION_PYTHON_BIN, [this.getWorkerPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        WHISPER_MODEL_SIZE: env.TRANSCRIPTION_MODEL_SIZE,
        WHISPER_DEVICE: env.TRANSCRIPTION_DEVICE,
        WHISPER_COMPUTE_TYPE: env.TRANSCRIPTION_COMPUTE_TYPE,
      },
    });

    const stdout = createInterface({ input: child.stdout });
    stdout.on('line', (line) => this.handleStdoutLine(line));

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      this.stderrBuffer.push(text);
      if (this.stderrBuffer.length > 20) {
        this.stderrBuffer = this.stderrBuffer.slice(-20);
      }
    });

    child.unref();
    maybeUnref(child.stdin);
    maybeUnref(child.stdout);
    maybeUnref(child.stderr);

    child.on('exit', (code, signal) => {
      const error = createWorkerError('Transcription worker exited unexpectedly', {
        code,
        signal,
        stderr: this.stderrBuffer.join('\n'),
      });
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeoutId);
        pending.reject(error);
      }
      this.pending.clear();
      this.child = null;
    });

    child.on('error', (cause) => {
      const error = createWorkerError('Failed to start transcription worker', {
        cause: String(cause),
      });
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeoutId);
        pending.reject(error);
      }
      this.pending.clear();
      this.child = null;
    });

    this.child = child;
    return child;
  }

  private handleStdoutLine(line: string): void {
    let parsed: WorkerResponse;
    try {
      parsed = JSON.parse(line) as WorkerResponse;
    } catch {
      return;
    }

    const pending = this.pending.get(parsed.requestId);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    this.pending.delete(parsed.requestId);

    if (parsed.ok) {
      pending.resolve(parsed.result);
      return;
    }

    pending.reject(createWorkerError('Transcription worker request failed', {
      error: parsed.error,
      traceback: parsed.traceback,
      stderr: this.stderrBuffer.join('\n'),
    }));
  }

  async transcribe(input: Omit<WorkerRequest, 'requestId'>): Promise<TranscriptionResult> {
    const child = this.startWorker();
    const requestId = `transcription-${Date.now()}-${this.requestSequence += 1}`;

    return new Promise<TranscriptionResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        this.child?.kill();
        this.child = null;
        reject(createWorkerError('Transcription worker timed out', {
          requestId,
          timeoutMs: env.TRANSCRIPTION_TIMEOUT_MS,
          stderr: this.stderrBuffer.join('\n'),
        }));
      }, env.TRANSCRIPTION_TIMEOUT_MS);

      this.pending.set(requestId, { resolve, reject, timeoutId });

      child.stdin.write(`${JSON.stringify({ ...input, requestId })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeoutId);
        this.pending.delete(requestId);
        reject(createWorkerError('Failed to send request to transcription worker', {
          cause: String(error),
        }));
      });
    });
  }
}

export const transcriptionWorkerBridge = new TranscriptionWorkerBridge();