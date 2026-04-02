import { describe, expect, it } from 'vitest';

import { buildThreadStateForWriter } from './writerInput';
import type { InterpolatorState } from './interpolatorTypes';

describe('buildThreadStateForWriter', () => {
  it('carries sanitized media findings into the writer contract', () => {
    const state: InterpolatorState = {
      rootUri: 'at://root',
      summaryText: '',
      salientClaims: [],
      salientContributors: [],
      clarificationsAdded: [],
      newAnglesAdded: [],
      repetitionLevel: 0,
      heatLevel: 0,
      sourceSupportPresent: false,
      updatedAt: new Date().toISOString(),
      version: 1,
      replyScores: {},
      entityLandscape: [],
      topContributors: [],
      evidencePresent: false,
      factualSignalPresent: false,
      lastTrigger: null,
      triggerHistory: [],
    };

    const output = buildThreadStateForWriter(
      'thread-1',
      'Root text about a screenshot',
      state,
      {},
      [],
      {
        surfaceConfidence: 0.7,
        entityConfidence: 0.6,
        interpretiveConfidence: 0.6,
      },
      undefined,
      'root.test',
      {
        summaryMode: 'normal',
        mediaFindings: [
          {
            mediaType: 'document',
            summary: '  This image shows a redlined policy draft with effective dates and highlighted changes.  ',
            confidence: 2,
            extractedText: '   EFFECTIVE JANUARY 1 FOR FEDERAL CONTRACTORS   ',
            cautionFlags: ['  partial-view  ', 'partial-view', 'cropped context'],
          },
        ],
      },
    );

    expect(output.mediaFindings).toEqual([
      {
        mediaType: 'document',
        summary: 'This image shows a redlined policy draft with effective dates and highlighted changes.',
        confidence: 1,
        extractedText: 'EFFECTIVE JANUARY 1 FOR FEDERAL CONTRACTORS',
        cautionFlags: ['partial-view', 'cropped context'],
      },
    ]);
  });
});
