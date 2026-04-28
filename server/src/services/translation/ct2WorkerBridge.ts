import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { env } from '../../config/env.js';
import { UpstreamError } from '../../lib/errors.js';

type Ct2Provider = 'marian' | 'm2m100';

type Ct2WorkerRequest = {
  requestId: string;
  provider: Ct2Provider;
  modelDir: string;
  hfDir: string;
  sourceLang: string;
  targetLang: string;
  text?: string;
  texts?: string[];
  targetPrefix?: string;
};

type Ct2WorkerResponse =
  | {
      requestId: string;
      ok: true;
      translatedText?: string;
      translatedTexts?: string[];
    }
  | {
      requestId: string;
      ok: false;
      error: string;
      traceback?: string;
    };

type PendingRequest = {
  resolve: (value: string | string[]) => void;
  reject: (reason?: unknown) => void;
  timeoutId: NodeJS.Timeout;
};

const DEFAULT_MODELS_DIR = fileURLToPath(new URL('../../../models/translation', import.meta.url));
const DEFAULT_WORKER_PATH = fileURLToPath(new URL('../../../scripts/translation_worker.py', import.meta.url));

function createWorkerError(message: string, details?: unknown): UpstreamError {
  return new UpstreamError(message, details, 502);
}

function maybeUnref(handle: unknown): void {
  if (!handle || typeof handle !== 'object') return;
  const candidate = handle as { unref?: () => void };
  candidate.unref?.();
}

class Ct2WorkerBridge {
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

  getModelsRootDir(): string {
    return env.TRANSLATION_MODELS_DIR || DEFAULT_MODELS_DIR;
  }

  private getWorkerPath(): string {
    return env.TRANSLATION_WORKER_PATH || DEFAULT_WORKER_PATH;
  }

  private startWorker(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;

    const child = spawn(env.TRANSLATION_PYTHON_BIN, [this.getWorkerPath()], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    const stdout = createInterface({ input: child.stdout });
    stdout.on('line', (line) => this.handleStdoutLine(line));

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      this.stderrBuffer.push(text.trim());
      if (this.stderrBuffer.length > 20) {
        this.stderrBuffer = this.stderrBuffer.slice(-20);
      }
    });

    child.unref();
  maybeUnref(child.stdin);
  maybeUnref(child.stdout);
  maybeUnref(child.stderr);

    child.on('exit', (code, signal) => {
      const message = `Translation worker exited unexpectedly (${code ?? 'null'}${signal ? `, ${signal}` : ''})`;
      const error = createWorkerError(message, { stderr: this.stderrBuffer.join('\n') });
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeoutId);
        pending.reject(error);
      }
      this.pending.clear();
      this.child = null;
    });

    child.on('error', (error) => {
      const wrapped = createWorkerError('Failed to start translation worker', { cause: String(error) });
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeoutId);
        pending.reject(wrapped);
      }
      this.pending.clear();
      this.child = null;
    });

    this.child = child;
    return child;
  }

  private handleStdoutLine(line: string): void {
    let parsed: Ct2WorkerResponse;
    try {
      parsed = JSON.parse(line) as Ct2WorkerResponse;
    } catch {
      return;
    }

    const pending = this.pending.get(parsed.requestId);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pending.delete(parsed.requestId);

    if (parsed.ok) {
      if (Array.isArray(parsed.translatedTexts)) {
        pending.resolve(parsed.translatedTexts);
      } else {
        pending.resolve(typeof parsed.translatedText === 'string' ? parsed.translatedText : '');
      }
      return;
    }

    pending.reject(
      createWorkerError('Translation worker request failed', {
        error: parsed.error,
        traceback: parsed.traceback,
        stderr: this.stderrBuffer.join('\n'),
      }),
    );
  }

  async translate(input: Omit<Ct2WorkerRequest, 'requestId'>): Promise<string> {
    const child = this.startWorker();
    const requestId = `translation-${Date.now()}-${this.requestSequence += 1}`;

    return new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        this.child?.kill();
        this.child = null;
        reject(
          createWorkerError('Translation worker timed out', {
            requestId,
            timeoutMs: env.TRANSLATION_TIMEOUT_MS,
            stderr: this.stderrBuffer.join('\n'),
          }),
        );
      }, env.TRANSLATION_TIMEOUT_MS);

      this.pending.set(requestId, {
        timeoutId,
        reject,
        resolve: (value) => {
          if (Array.isArray(value)) {
            resolve(value[0] ?? '');
            return;
          }
          resolve(value);
        },
      });

      child.stdin.write(`${JSON.stringify({ ...input, requestId })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeoutId);
        this.pending.delete(requestId);
        reject(createWorkerError('Failed to send request to translation worker', { cause: String(error) }));
      });
    });
  }

  async translateBatch(input: Omit<Ct2WorkerRequest, 'requestId' | 'text'> & { texts: string[] }): Promise<string[]> {
    if (input.texts.length === 0) return [];
    const child = this.startWorker();
    const requestId = `translation-batch-${Date.now()}-${this.requestSequence += 1}`;

    return new Promise<string[]>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(requestId);
        this.child?.kill();
        this.child = null;
        reject(
          createWorkerError('Translation worker batch timed out', {
            requestId,
            timeoutMs: env.TRANSLATION_TIMEOUT_MS,
            stderr: this.stderrBuffer.join('\n'),
            count: input.texts.length,
          }),
        );
      }, env.TRANSLATION_TIMEOUT_MS);

      this.pending.set(requestId, {
        timeoutId,
        resolve: (value) => {
          if (Array.isArray(value)) {
            resolve(value);
            return;
          }
          resolve([value]);
        },
        reject,
      });

      child.stdin.write(`${JSON.stringify({ ...input, requestId })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeoutId);
        this.pending.delete(requestId);
        reject(createWorkerError('Failed to send batch request to translation worker', { cause: String(error) }));
      });
    });
  }
}

export const ct2WorkerBridge = new Ct2WorkerBridge();