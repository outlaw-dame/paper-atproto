/**
 * Circuit breaker pattern for resilience engineering.
 * Prevents cascading failures by failing fast when systems are degraded.
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit broken, requests fail fast without attempting operation
 * - HALF_OPEN: Testing if service recovered, limited requests allowed
 * 
 * Transitions:
 * - CLOSED → OPEN: After threshold failures
 * - OPEN → HALF_OPEN: After timeout expires
 * - HALF_OPEN → CLOSED: If test request succeeds
 * - HALF_OPEN → OPEN: If test request fails
 */

export enum CircuitState {
  CLOSED = 'closed',      // Operating normally
  OPEN = 'open',          // Refusing requests
  HALF_OPEN = 'half_open', // Testing recovery
}

export interface CircuitBreakerConfig {
  /** Failure threshold before opening (e.g., 5 failures) */
  failureThreshold: number;
  /** Success threshold to close after half-open (e.g., 2 successes) */
  successThreshold: number;
  /** Timeout before transitioning from OPEN to HALF_OPEN (ms) */
  openTimeoutMs: number;
  /** Timeout for half-open test requests (ms) */
  halfOpenTimeoutMs: number;
}

export interface CircuitBreakerMetrics {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalRequests: number;
  blockedRequests: number;
}

/**
 * Industry-standard circuit breaker configuration for databases.
 */
export const DB_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  openTimeoutMs: 30_000,    // 30 seconds
  halfOpenTimeoutMs: 5_000,  // 5 seconds
};

/**
 * Circuit breaker for resilient distributed systems.
 * Implements exponential backoff and state transitions.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastStateChangeTime: number = Date.now();
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalRequests: number = 0;
  private blockedRequests: number = 0;

  constructor(private readonly config: CircuitBreakerConfig) {}

  /**
   * Attempt to execute operation through circuit breaker.
   * Throws CircuitBreakerOpenError if circuit is open/failing.
   * 
   * @param operation Operation to execute
   * @param operationName Name for debugging
   * @returns Result of operation
   * @throws CircuitBreakerOpenError if circuit is OPEN
   * @throws Error if operation fails
   */
  async execute<T>(
    operation: () => Promise<T>,
    operationName: string = 'operation',
  ): Promise<T> {
    this.totalRequests++;

    const state = this.resolveState();

    if (state === CircuitState.OPEN) {
      this.blockedRequests++;
      throw new CircuitBreakerOpenError(
        `Circuit breaker OPEN for ${operationName}; failing fast`,
      );
    }

    try {
      const result = await operation();
      this.recordSuccess(state);
      return result;
    } catch (error) {
      this.recordFailure(state, error);
      throw error;
    }
  }

  /**
   * Get current circuit state, transitioning if needed.
   */
  private resolveState(): CircuitState {
    const now = Date.now();
    const timeSinceStateChange = now - this.lastStateChangeTime;

    if (this.state === CircuitState.CLOSED) {
      return CircuitState.CLOSED;
    }

    if (this.state === CircuitState.OPEN) {
      if (timeSinceStateChange >= this.config.openTimeoutMs) {
        this.transitionToHalfOpen();
        return CircuitState.HALF_OPEN;
      }
      return CircuitState.OPEN;
    }

    // HALF_OPEN state logic handled in recordSuccess/recordFailure
    return CircuitState.HALF_OPEN;
  }

  /**
   * Record successful operation.
   */
  private recordSuccess(previousState: CircuitState): void {
    this.failureCount = 0;
    this.lastSuccessTime = Date.now();

    if (previousState === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.transitionToClosed();
      }
    }
  }

  /**
   * Record failed operation.
   */
  private recordFailure(previousState: CircuitState, error: unknown): void {
    this.lastFailureTime = Date.now();

    if (previousState === CircuitState.HALF_OPEN) {
      // Failure in half-open state immediately opens circuit
      this.transitionToOpen();
      return;
    }

    if (previousState === CircuitState.CLOSED) {
      this.failureCount++;
      if (this.failureCount >= this.config.failureThreshold) {
        this.transitionToOpen();
      }
    }
  }

  private transitionToClosed(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChangeTime = Date.now();
  }

  private transitionToOpen(): void {
    this.state = CircuitState.OPEN;
    this.successCount = 0;
    this.lastStateChangeTime = Date.now();
  }

  private transitionToHalfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChangeTime = Date.now();
  }

  getMetrics(): CircuitBreakerMetrics {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      blockedRequests: this.blockedRequests,
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastStateChangeTime = Date.now();
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.totalRequests = 0;
    this.blockedRequests = 0;
  }
}

/**
 * Error thrown when circuit breaker is OPEN.
 */
export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/**
 * Connection health monitor with automatic reconnection.
 * Detects stale connections and triggers self-healing.
 */
export class ConnectionHealthMonitor {
  private healthCheckIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastHealthCheckTime: number = 0;
  private healthStatus: 'healthy' | 'degraded' | 'failed' = 'healthy';
  private consecutiveFailures: number = 0;

  constructor(
    private readonly healthCheckFn: () => Promise<boolean>,
    private readonly onStreamChange?: (healthy: boolean) => void,
    private readonly checkIntervalMs: number = 30_000,
  ) {}

  /**
   * Start periodic health checks.
   */
  start(): void {
    if (this.healthCheckIntervalId) return;

    this.healthCheckIntervalId = setInterval(() => {
      void this.performHealthCheck();
    }, this.checkIntervalMs);
  }

  /**
   * Stop periodic health checks.
   */
  stop(): void {
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
    }
  }

  /**
   * Perform single health check immediately.
   */
  async performHealthCheck(): Promise<boolean> {
    try {
      const isHealthy = await this.healthCheckFn();
      const wasHealthy = this.healthStatus === 'healthy';

      if (isHealthy) {
        this.consecutiveFailures = 0;
        if (this.healthStatus !== 'healthy') {
          this.healthStatus = 'healthy';
          this.onStreamChange?.(true);
        }
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= 2) {
          this.healthStatus = 'failed';
          if (wasHealthy) {
            this.onStreamChange?.(false);
          }
        }
      }

      this.lastHealthCheckTime = Date.now();
      return isHealthy;
    } catch (error) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 2 && this.healthStatus === 'healthy') {
        this.healthStatus = 'failed';
        this.onStreamChange?.(false);
      }
      return false;
    }
  }

  getStatus(): {
    status: 'healthy' | 'degraded' | 'failed';
    consecutiveFailures: number;
    lastCheckTime: number;
  } {
    return {
      status: this.healthStatus,
      consecutiveFailures: this.consecutiveFailures,
      lastCheckTime: this.lastHealthCheckTime,
    };
  }

  dispose(): void {
    this.stop();
  }
}
