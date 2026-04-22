import { describe, expect, it, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitState,
  ConnectionHealthMonitor,
  DB_CIRCUIT_BREAKER_CONFIG,
} from './circuitBreaker';

describe('CircuitBreaker', () => {
  it('operates normally in CLOSED state', async () => {
    const breaker = new CircuitBreaker(DB_CIRCUIT_BREAKER_CONFIG);
    
    const result = await breaker.execute(async () => 'success');
    
    expect(result).toBe('success');
    expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
  });

  it('transitions to OPEN after failure threshold', async () => {
    const config = { ...DB_CIRCUIT_BREAKER_CONFIG, failureThreshold: 2 };
    const breaker = new CircuitBreaker(config);
    
    // First failure
    await expect(
      breaker.execute(async () => {
        throw new Error('Fail 1');
      }),
    ).rejects.toThrow('Fail 1');
    
    expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
    expect(breaker.getMetrics().failureCount).toBe(1);
    
    // Second failure triggers OPEN
    await expect(
      breaker.execute(async () => {
        throw new Error('Fail 2');
      }),
    ).rejects.toThrow('Fail 2');
    
    expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);
  });

  it('fails fast when OPEN', async () => {
    const config = { ...DB_CIRCUIT_BREAKER_CONFIG, failureThreshold: 1 };
    const breaker = new CircuitBreaker(config);
    
    // Open the circuit
    await expect(
      breaker.execute(async () => {
        throw new Error('Trip breaker');
      }),
    ).rejects.toThrow('Trip breaker');
    
    // Now circuit is OPEN, subsequent calls fail fast
    await expect(
      breaker.execute(async () => 'This should not execute'),
    ).rejects.toThrow('Circuit breaker OPEN');
    
    expect(breaker.getMetrics().blockedRequests).toBe(1);
  });

  it('transitions to HALF_OPEN after timeout', async () => {
    const config = {
      failureThreshold: 1,
      successThreshold: 1,
      openTimeoutMs: 100,
      halfOpenTimeoutMs: 100,
    };
    const breaker = new CircuitBreaker(config);
    
    // Trip the breaker
    await expect(
      breaker.execute(async () => {
        throw new Error('Trip');
      }),
    ).rejects.toThrow();
    
    expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);
    
    // Wait for timeout
    vi.useFakeTimers();
    vi.advanceTimersByTime(110);
    
    // Next execution should be in HALF_OPEN state (attempting to recover)
    const result = await breaker.execute(async () => 'recovery success');
    
    expect(result).toBe('recovery success');
    expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
    
    vi.useRealTimers();
  });

  it('reopens on failure in HALF_OPEN', async () => {
    const config = {
      failureThreshold: 1,
      successThreshold: 1,
      openTimeoutMs: 50,
      halfOpenTimeoutMs: 100,
    };
    const breaker = new CircuitBreaker(config);
    
    // Trip the breaker
    await expect(
      breaker.execute(async () => {
        throw new Error('Trip');
      }),
    ).rejects.toThrow();
    
    vi.useFakeTimers();
    vi.advanceTimersByTime(60);
    
    // Fail in HALF_OPEN state immediately opens again
    await expect(
      breaker.execute(async () => {
        throw new Error('Still failing');
      }),
    ).rejects.toThrow('Still failing');
    
    expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);
    
    vi.useRealTimers();
  });

  it('tracks metrics', async () => {
    const breaker = new CircuitBreaker(DB_CIRCUIT_BREAKER_CONFIG);
    
    // Successful requests
    await breaker.execute(async () => 'success 1');
    await breaker.execute(async () => 'success 2');
    
    const metrics = breaker.getMetrics();
    
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.blockedRequests).toBe(0);
    expect(metrics.state).toBe(CircuitState.CLOSED);
  });

  it('resets state', async () => {
    const config = { ...DB_CIRCUIT_BREAKER_CONFIG, failureThreshold: 1 };
    const breaker = new CircuitBreaker(config);
    
    // Open the circuit
    await expect(
      breaker.execute(async () => {
        throw new Error('Trip');
      }),
    ).rejects.toThrow();
    
    expect(breaker.getMetrics().state).toBe(CircuitState.OPEN);
    
    // Reset
    breaker.reset();
    
    expect(breaker.getMetrics().state).toBe(CircuitState.CLOSED);
    expect(breaker.getMetrics().failureCount).toBe(0);
    expect(breaker.getMetrics().totalRequests).toBe(0);
  });
});

describe('CircuitBreakerOpenError', () => {
  it('creates proper error with name', () => {
    const error = new CircuitBreakerOpenError('Circuit is open');
    
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CircuitBreakerOpenError');
    expect(error.message).toBe('Circuit is open');
  });
});

describe('ConnectionHealthMonitor', () => {
  it('starts and stops monitoring', async () => {
    const healthCheckFn = vi.fn(async () => true);
    const onStatusChange = vi.fn();
    
    const monitor = new ConnectionHealthMonitor(
      healthCheckFn,
      onStatusChange,
      50, // Check every 50ms
    );
    
    monitor.start();
    
    // Wait for first check to happen
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    expect(healthCheckFn).toHaveBeenCalled();
    
    monitor.stop();
    
    const expectedCallsBefore = healthCheckFn.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    // Should not have been called again after stop
    expect(healthCheckFn.mock.calls.length).toBe(expectedCallsBefore);
  });

  it('reports degraded status after consecutive failures', async () => {
    const healthCheckFn = vi.fn(async () => false);
    const onStatusChange = vi.fn();
    
    const monitor = new ConnectionHealthMonitor(
      healthCheckFn,
      onStatusChange,
      10,
    );
    
    // First failure: status still healthy
    await monitor.performHealthCheck();
    expect(onStatusChange).not.toHaveBeenCalled();
    
    // Second failure: status becomes failed
    await monitor.performHealthCheck();
    expect(onStatusChange).toHaveBeenCalledWith(false);
  });

  it('recovers health status', async () => {
    let isHealthy = false;
    const healthCheckFn = vi.fn(async () => isHealthy);
    const onStatusChange = vi.fn();
    
    const monitor = new ConnectionHealthMonitor(
      healthCheckFn,
      onStatusChange,
    );
    
    // Fail twice to degrade
    await monitor.performHealthCheck();
    await monitor.performHealthCheck();
    
    expect(onStatusChange).toHaveBeenCalledWith(false);
    onStatusChange.mockClear();
    
    // Recover
    isHealthy = true;
    await monitor.performHealthCheck();
    
    expect(onStatusChange).toHaveBeenCalledWith(true);
  });

  it('provides status info', async () => {
    const healthCheckFn = vi.fn(async () => true);
    const monitor = new ConnectionHealthMonitor(healthCheckFn);
    
    await monitor.performHealthCheck();
    
    const status = monitor.getStatus();
    
    expect(status.status).toBe('healthy');
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastCheckTime).toBeGreaterThan(0);
  });

  it('disposes resources', async () => {
    const healthCheckFn = vi.fn(async () => true);
    const monitor = new ConnectionHealthMonitor(healthCheckFn, undefined, 50);
    
    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    const callsBeforeDispose = healthCheckFn.mock.calls.length;
    
    monitor.dispose();
    
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    // Should not have been called after dispose
    expect(healthCheckFn.mock.calls.length).toBe(callsBeforeDispose);
  });
});
