import { describe, expect, it } from 'vitest';
import {
  LOCAL_USER_DATA_SURFACES,
  summarizeLocalUserDataPolicy,
  validateLocalUserDataPolicy,
} from './localUserDataPolicy';

describe('local user data policy', () => {
  it('declares app-owned user data as local-only, resettable, and bounded', () => {
    const report = validateLocalUserDataPolicy();

    expect(report.valid).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.surfaceCount).toBeGreaterThanOrEqual(6);
    expect(report.surfaces.every((surface) => surface.remoteSync === 'forbidden')).toBe(true);
    expect(report.surfaces.every((surface) => surface.storageScope.startsWith('browser-') || surface.storageScope === 'memory')).toBe(true);
    expect(report.surfaces.every((surface) => surface.resettable && surface.bounded)).toBe(true);
  });

  it('keeps personalization and local preferences free of raw content', () => {
    const sensitivePreferenceSurfaces = LOCAL_USER_DATA_SURFACES.filter(
      (surface) => surface.category === 'local_personalization' || surface.category === 'local_preference',
    );

    expect(sensitivePreferenceSurfaces.length).toBeGreaterThanOrEqual(2);
    expect(sensitivePreferenceSurfaces.every((surface) => !surface.containsRawContent)).toBe(true);
    expect(
      sensitivePreferenceSurfaces
        .filter((surface) => surface.category === 'local_personalization')
        .every((surface) => !surface.containsProtocolIdentifiers),
    ).toBe(true);
  });

  it('fails closed if a user-data surface attempts remote sync', () => {
    const report = validateLocalUserDataPolicy([
      {
        id: 'bad.remote-history',
        category: 'content_history',
        storageKey: 'bad-history',
        storageScope: 'browser-local',
        remoteSync: 'forbidden',
        resettable: false,
        bounded: false,
        retention: 'until-user-reset',
        containsRawContent: true,
        containsProtocolIdentifiers: true,
        notes: 'Invalid because it is neither resettable nor bounded.',
      },
    ]);

    expect(report.valid).toBe(false);
    expect(report.failures).toContain('bad.remote-history:not_resettable');
    expect(report.failures).toContain('bad.remote-history:not_bounded');
  });

  it('summarizes policy coverage for privacy UI and diagnostics', () => {
    expect(summarizeLocalUserDataPolicy()).toMatchObject({
      content_history: expect.any(Number),
      local_personalization: expect.any(Number),
      local_preference: expect.any(Number),
      ui_resume: expect.any(Number),
      diagnostic_history: expect.any(Number),
    });
  });
});
