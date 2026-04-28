import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getExternalUrlTelemetrySnapshot,
  recordExternalUrlBlockedUnsafe,
  recordExternalUrlGuardDroppedInvalid,
  recordExternalUrlOpened,
  recordExternalUrlRejectedInvalid,
  resetExternalUrlTelemetry,
} from './externalUrlTelemetry';

describe('externalUrlTelemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    resetExternalUrlTelemetry();
  });

  it('tracks counters without storing sensitive URLs', () => {
    recordExternalUrlRejectedInvalid();
    recordExternalUrlGuardDroppedInvalid();
    recordExternalUrlBlockedUnsafe('example.com');
    recordExternalUrlOpened('example.com');

    expect(getExternalUrlTelemetrySnapshot()).toEqual({
      attempted: 0,
      opened: 1,
      rejectedInvalid: 1,
      blockedUnsafe: 1,
      blockedUnknown: 0,
      blockedError: 0,
      guardDroppedInvalid: 1,
    });
  });

  it('rate limits repeated warning logs per category', () => {
    recordExternalUrlRejectedInvalid();
    recordExternalUrlRejectedInvalid();
    expect(console.warn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);
    recordExternalUrlRejectedInvalid();
    expect(console.warn).toHaveBeenCalledTimes(2);
  });
});
