import { describe, expect, it, vi } from 'vitest';
import {
  BackoffTimer,
  calculateBackoffDelay,
  SEARCH_BACKOFF_CONFIG,
  STANDARD_BACKOFF_CONFIG,
  sleep,
} from './backoffStrategy';

describe('calculateBackoffDelay', () => {
  it('calculates exponential backoff without jitter', () => {
    const config = { ...STANDARD_BACKOFF_CONFIG, useJitter: false };
    
    expect(calculateBackoffDelay(config, 0)).toBe(100); // baseDelay
    expect(calculateBackoffDelay(config, 1)).toBe(200); // baseDelay * 2^1
    expect(calculateBackoffDelay(config, 2)).toBe(400); // baseDelay * 2^2
    expect(calculateBackoffDelay(config, 3)).toBe(800);
  });

  it('respects maxDelayMs cap', () => {
    const config = { ...STANDARD_BACKOFF_CONFIG, useJitter: false };
    const maxDelay = calculateBackoffDelay(config, 20);
    
    expect(maxDelay).toBeLessThanOrEqual(config.maxDelayMs);
  });

  it('applies jitter when enabled', () => {
    const config = { ...STANDARD_BACKOFF_CONFIG, useJitter: true };
    const delays = Array.from({ length: 10 }, () => calculateBackoffDelay(config, 2));
    
    // With jitter, delays should vary
    const uniqueDelays = new Set(delays);
    expect(uniqueDelays.size).toBeGreaterThan(1);
    
    // All delays should be within bounds
    delays.forEach((delay) => {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(400);
    });
  });

  it('handles invalid attempts gracefully', () => {
    const config = { ...STANDARD_BACKOFF_CONFIG, useJitter: false };
    
    expect(calculateBackoffDelay(config, -1)).toBe(0);
    expect(calculateBackoffDelay(config, NaN)).toBe(0);
    expect(calculateBackoffDelay(config, 1.5)).toBe(200); // Truncated to 1
  });
});

describe('BackoffTimer', () => {
  it('retries operation on failure', async () => {
    const timer = new BackoffTimer(SEARCH_BACKOFF_CONFIG);
    let attempts = 0;
    
    const result = await timer.execute(async () => {
      attempts++;
      if (attempts < 2) throw new Error('Fail first time');
      return 'success';
    });
    
    expect(result).toBe('success');
    expect(attempts).toBe(2);
  });

  it('throws after max retries exhausted', async () => {
    const timer = new BackoffTimer({ ...SEARCH_BACKOFF_CONFIG, maxRetries: 2 });
    let attempts = 0;
    
    await expect(
      timer.execute(async () => {
        attempts++;
        throw new Error('Always fails');
      }, 'test operation'),
    ).rejects.toThrow('test operation failed after 3 attempts');
    
    expect(attempts).toBe(3);
  });

  it('respects time budget', async () => {
    const timer = new BackoffTimer({
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      multiplier: 2,
      useJitter: false,
    });
    
    const startTime = Date.now();
    let attempts = 0;
    
    await expect(
      timer.executeWithTimeBudget(
        async () => {
          attempts++;
          throw new Error('Fails each time');
        },
        500, // 500ms budget
        'test',
      ),
    ).rejects.toThrow();
    
    const elapsedMs = Date.now() - startTime;
    
    // Should not exceed budget by too much (allowing some margin for execution time)
    expect(elapsedMs).toBeLessThan(1_000);
    // Should have attempted multiple times
    expect(attempts).toBeGreaterThan(1);
  });

  it('returns result immediately on success', async () => {
    const timer = new BackoffTimer(STANDARD_BACKOFF_CONFIG);
    
    const result = await timer.execute(async () => 'immediate success');
    
    expect(result).toBe('immediate success');
  });

  it('provides debug info', () => {
    const debugInfo = BackoffTimer.getDebugInfo(SEARCH_BACKOFF_CONFIG, 4);
    
    expect(debugInfo).toHaveLength(4);
    expect(debugInfo[0]).toBeDefined();
    expect(debugInfo[0]!.attempt).toBe(0);
    expect(debugInfo[0]!.delay).toBeGreaterThanOrEqual(0);
    expect(debugInfo[0]!.totalDelayMs).toBeGreaterThanOrEqual(0);
  });
});

describe('sleep', () => {
  it('resolves after specified duration', async () => {
    const startTime = Date.now();
    await sleep(50);
    const elapsedMs = Date.now() - startTime;
    
    expect(elapsedMs).toBeGreaterThanOrEqual(40); // Some tolerance
  });

  it('handles zero duration', async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
  });

  it('handles invalid duration', async () => {
    await expect(sleep(-100)).resolves.toBeUndefined();
    await expect(sleep(NaN)).resolves.toBeUndefined();
  });

  it('supports abort signal', async () => {
    const abortController = new AbortController();
    
    const sleepPromise = sleep(5_000, abortController.signal);
    
    // Abort after a short delay
    setTimeout(() => abortController.abort(), 50);
    
    await expect(sleepPromise).rejects.toThrow();
  });
});
