interface ModerationLabelerTelemetrySnapshot {
  labelPrefWriteAttempts: number;
  labelPrefWriteFailures: number;
  unavailableLabelerDetections: number;
  lastUnavailableCount: number;
}

const telemetry = {
  labelPrefWriteAttempts: 0,
  labelPrefWriteFailures: 0,
  unavailableLabelerDetections: 0,
  lastUnavailableCount: 0,
};

function snapshot(): ModerationLabelerTelemetrySnapshot {
  return {
    ...telemetry,
  };
}

function publishSnapshot(): void {
  if (typeof window === 'undefined') return;
  (window as Window & { __GLYMPSE_MODERATION_LABELER_METRICS__?: ModerationLabelerTelemetrySnapshot }).__GLYMPSE_MODERATION_LABELER_METRICS__ = snapshot();
}

export function recordLabelPrefWriteAttempt(): void {
  telemetry.labelPrefWriteAttempts += 1;
  publishSnapshot();
}

export function recordLabelPrefWriteFailure(): void {
  telemetry.labelPrefWriteFailures += 1;
  publishSnapshot();
}

export function recordUnavailableLabelersDetected(count: number): void {
  const safeCount = Math.max(0, Math.floor(count));
  telemetry.lastUnavailableCount = safeCount;
  if (safeCount > 0) {
    telemetry.unavailableLabelerDetections += 1;
  }
  publishSnapshot();
}

export function getModerationLabelerTelemetrySnapshot(): ModerationLabelerTelemetrySnapshot {
  return snapshot();
}
