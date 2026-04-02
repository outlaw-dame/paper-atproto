type CircuitState = 'closed' | 'open' | 'half_open';

export type CircuitBreakerOptions = {
  failureThreshold: number;
  openMs: number;
  halfOpenMaxTrials?: number;
};

export class CircuitOpenError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('Circuit breaker is open');
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly halfOpenMaxTrials: number;

  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private halfOpenTrials = 0;

  constructor(options: CircuitBreakerOptions) {
    this.failureThreshold = Math.max(1, Math.floor(options.failureThreshold));
    this.openMs = Math.max(1000, Math.floor(options.openMs));
    this.halfOpenMaxTrials = Math.max(1, Math.floor(options.halfOpenMaxTrials ?? 1));
  }

  currentState(now = Date.now()): CircuitState {
    if (this.state === 'open' && now - this.openedAt >= this.openMs) {
      this.state = 'half_open';
      this.halfOpenTrials = 0;
    }
    return this.state;
  }

  assertCanRequest(now = Date.now()): void {
    const state = this.currentState(now);
    if (state === 'closed') return;

    if (state === 'open') {
      const retryAfterMs = Math.max(0, this.openMs - (now - this.openedAt));
      throw new CircuitOpenError(retryAfterMs);
    }

    if (this.halfOpenTrials >= this.halfOpenMaxTrials) {
      throw new CircuitOpenError(this.openMs);
    }

    this.halfOpenTrials += 1;
  }

  recordSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
    this.halfOpenTrials = 0;
  }

  recordFailure(now = Date.now()): void {
    if (this.state === 'half_open') {
      this.state = 'open';
      this.openedAt = now;
      this.consecutiveFailures = this.failureThreshold;
      this.halfOpenTrials = 0;
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = now;
      this.halfOpenTrials = 0;
    }
  }
}
