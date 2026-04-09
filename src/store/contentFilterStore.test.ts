import { describe, expect, it } from 'vitest';

import { migrateContentFilterState } from './contentFilterStore';

describe('migrateContentFilterState', () => {
  it('adds excludeFollowingFromFilters=false when migrating from v1', () => {
    const v1State = {
      rules: [
        {
          id: 'rule-1',
          phrase: 'spoiler',
          action: 'hide',
          enabled: true,
          contexts: ['home'],
          createdAt: new Date().toISOString(),
          wholeWord: false,
          semantic: true,
          semanticThreshold: 0.72,
          expiresAt: null,
        },
      ],
    };

    const migrated = migrateContentFilterState(v1State, 1) as any;

    expect(migrated.excludeFollowingFromFilters).toBe(false);
    expect(migrated.rules).toHaveLength(1);
    expect(migrated.rules[0].phrase).toBe('spoiler');
  });

  it('preserves explicit excludeFollowingFromFilters value', () => {
    const v2State = {
      rules: [],
      excludeFollowingFromFilters: true,
    };

    const migrated = migrateContentFilterState(v2State, 2) as any;

    expect(migrated.excludeFollowingFromFilters).toBe(true);
  });

  it('handles non-object input safely', () => {
    const migrated = migrateContentFilterState(undefined as any, 1) as any;
    expect(migrated).toEqual({ rules: [], excludeFollowingFromFilters: false });
  });
});
