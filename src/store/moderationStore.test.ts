import { describe, expect, it } from 'vitest';

import { pruneExpiredTimedMutes } from './moderationStore';

describe('moderation store stale mute pruning', () => {
  it('removes expired timed mutes and preserves active or indefinite ones', () => {
    const now = 1_700_000_000_000;

    const result = pruneExpiredTimedMutes(
      {
        'did:plc:expired': now - 1,
        'did:plc:active': now + 10_000,
        'did:plc:indefinite': 0,
      },
      now,
    );

    expect(result).toEqual({
      'did:plc:active': now + 10_000,
      'did:plc:indefinite': 0,
    });
  });

  it('drops malformed non-finite expiry values', () => {
    const now = 1_700_000_000_000;

    const result = pruneExpiredTimedMutes(
      {
        'did:plc:nan': Number.NaN,
        'did:plc:infinite': Number.POSITIVE_INFINITY,
        'did:plc:ok': now + 1,
      },
      now,
    );

    expect(result).toEqual({
      'did:plc:ok': now + 1,
    });
  });
});
