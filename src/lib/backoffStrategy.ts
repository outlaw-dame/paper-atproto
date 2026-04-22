/**
 * Exponential backoff strategies with industry-standard behavior.
 * Implements jitter-enhanced backoff to prevent thundering herd problems.
 * 
 * References:
 * - AWS SDK: Exponential backoff with full jitter
 * - Google Cloud: Truncated exponential backoff with jitter
 * - RFC 7231: HTTP retry semantics
 */

export interface BackoffConfig {
  /** Base delay in milliseconds (e.g., 100ms) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (e.g., 30s) */
  maxDelayMs: number;
  /** Multiplier for exponential growth (e.g., 2.0) */
  multiplier: number;
  /** Whether to apply jitter to randomize delays */
  useJitter: boolean;
  /** Max number of retries before giving up */
  maxRetries?: number;
}

export interface BackoffState {
  attempt: number;
  delay: number;
  totalDelayMs: number;
}

/**
 * Industry-standard exponential backoff configuration.
 * Balances quick recovery with load reduction.
 */
export const STANDARD_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 100,
  maxDelayMs: 30_000,
  multiplier: 2.0,
  useJitter: true,
  maxRetries: 5,
};

/**
 * Configuration for search timeouts (more aggressive, shorter max).
 */
export const SEARCH_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 50,
  maxDelayMs: 2_000,
  multiplier: 1.5,
  useJitter: true,
  maxRetries: 3,
};

/**
 * Calculate exponential backoff delay with optional jitter.
 * 
 * Formula (without jitter): min(baseDelay * (multiplier ^ attempt), maxDelay)
 * Formula (with jitter): random(0, exponentialDelay)
 * 
 * Jitter prevents synchronized retry storms (thundering herd).
 * @param config Backoff configuration
 * @param attempt Zero-indexed attempt number
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(config: BackoffConfig, attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) {
    return 0;
  }

  const cappedAttempt = Math.min(Math.trunc(attempt), 100); // Prevent overflow
  const exponentialDelay = config.baseDelayMs * Math.pow(config.multiplier, cappedAttempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  if (!config.useJitter) {
    return Math.trunc(cappedDelay);
  }

  // Full jitter: random value between 0 and capped delay
  // Prevents synchronized retries from multiple clients
  const jitteredDelay = Math.random() * cappedDelay;
  return Math.trunc(jitteredDelay);
}

/**
 * Create a backoff timer that executes async operations with exponential backoff.
 * Automatically handles retries, timeouts, and state tracking.
 * 
 * Example:
 * ```typescript
 * const timer = new BackoffTimer(SEARCH_BACKOFF_CONFIG);
 * const result = await timer.execute(() => myAsyncOperation(), 'Search operation');
 * ```
 */
export class BackoffTimer {
  private readonly config: BackoffConfig;

  constructor(config: BackoffConfig = STANDARD_BACKOFF_CONFIG) {
    this.config = { ...config };
  }

  /**
   * Retrieve current configuration (defensive copy).
   */
  getConfig(): BackoffConfig {
    return { ...this.config };
  }

  /**
   * Execute async operation with automatic exponential backoff on failure.
   * 
   * Retries the operation up to config.maxRetries times, with exponential delay between attempts.
   * Throws if all retries exhausted.
   * 
   * @param operation Async operation to execute
   * @param operationName Human-readable operation name for debugging
   * @returns Result of operation
   * @throws Final error from operation if all retries exhausted
   */
  async execute<T>(
    operation: () => Promise<T>,
    operationName: string = 'operation',
  ): Promise<T> {
    const maxAttempts = (this.config.maxRetries ?? 1) + 1;
    let lastError: Error | unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Don't delay on last attempt
        if (attempt < maxAttempts - 1) {
          const delayMs = calculateBackoffDelay(this.config, attempt);
          if (delayMs > 0) {
            await new Promise<void>((resolve) => {
              setTimeout(resolve, delayMs);
            });
          }
        }
      }
    }

    // All retries exhausted
    if (lastError instanceof Error) {
      const message = `${operationName} failed after ${maxAttempts} attempts: ${lastError.message}`;
      const enhancedError = new Error(message);
      enhancedError.cause = lastError;
      throw enhancedError;
    }

    throw new Error(`${operationName} failed after ${maxAttempts} attempts`);
  }

  /**
   * Execute operation with a maximum time budget.
   * Stops retrying if total elapsed time exceeds timeBudgetMs.
   * 
   * @param operation Async operation to execute
   * @param timeBudgetMs Maximum total time to spend (including delays)
   * @param operationName Human-readable operation name
   * @returns Result of operation
   * @throws Error if time budget exceeded or operation fails
   */
  async executeWithTimeBudget<T>(
    operation: () => Promise<T>,
    timeBudgetMs: number,
    operationName: string = 'operation',
  ): Promise<T> {
    if (!Number.isFinite(timeBudgetMs) || timeBudgetMs <= 0) {
      return await operation();
    }

    const startTime = Date.now();
    let attempt = 0;
    let lastError: Error | unknown = null;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const elapsedMs = Date.now() - startTime;

        // Check if we have time for another attempt
        const delayMs = calculateBackoffDelay(this.config, attempt);
        if (elapsedMs + delayMs > timeBudgetMs) {
          break; // Time budget exhausted
        }

        if (delayMs > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, delayMs);
          });
        }

        attempt++;
      }
    }

    // Time budget exhausted
    const elapsedMs = Date.now() - startTime;
    if (lastError instanceof Error) {
      const message = `${operationName} failed within ${elapsedMs}ms budget: ${lastError.message}`;
      const enhancedError = new Error(message);
      enhancedError.cause = lastError;
      throw enhancedError;
    }

    throw new Error(`${operationName} failed within ${elapsedMs}ms budget`);
  }

  /**
   * Get debugging information about backoff state.
   */
  static getDebugInfo(config: BackoffConfig, maxAttempts: number): BackoffState[] {
    const states: BackoffState[] = [];
    let totalDelayMs = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const delay = calculateBackoffDelay(config, attempt);
      totalDelayMs += delay;
      states.push({ attempt, delay, totalDelayMs });
    }

    return states;
  }
}

/**
 * Asynchronous sleep with cancellation support.
 * @param ms Duration in milliseconds
 * @param abortSignal Optional AbortSignal to cancel sleep early
 */
export async function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }

  return await new Promise<void>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new DOMException('Sleep aborted', 'AbortError'));
      return;
    }

    const timeoutId = setTimeout(() => {
      abortSignal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Sleep aborted', 'AbortError'));
    };

    if (abortSignal) {
      abortSignal.addEventListener('abort', handleAbort, { once: true });
    }
  });
}
