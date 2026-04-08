import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ThreadNode } from '../lib/resolver/atproto';
import { runInterpolatorPipeline } from './atprotoInterpolatorAdapter';
import {
  clearThreadSnapshot,
  detectMeaningfulChange,
  getThreadSnapshotInfo,
  recordThreadSnapshot,
} from './updateInterpolatorState';

function makeReply(params: {
  uri: string;
  text: string;
  authorDid?: string;
  authorHandle?: string;
  likeCount?: number;
}): ThreadNode {
  return {
    uri: params.uri,
    cid: `${params.uri}-cid`,
    authorDid: params.authorDid ?? `did:plc:${params.uri.replace(/[^a-z0-9]/gi, '').slice(-12) || 'author'}`,
    authorHandle: params.authorHandle ?? `${params.uri.replace(/[^a-z0-9]/gi, '').slice(-8) || 'author'}.test`,
    text: params.text,
    createdAt: '2026-04-06T00:00:00.000Z',
    likeCount: params.likeCount ?? 0,
    replyCount: 0,
    repostCount: 0,
    facets: [],
    embed: null,
    labels: [],
    depth: 1,
    replies: [],
  };
}

describe('runInterpolatorPipeline', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearThreadSnapshot('at://thread/test');
  });

  it('does not refresh an existing state when the hydrated thread has not materially changed', () => {
    const replies = [
      makeReply({ uri: 'at://reply/1', text: 'I agree with the basic point here.' }),
      makeReply({ uri: 'at://reply/2', text: 'This seems directionally right, though details are thin.' }),
      makeReply({ uri: 'at://reply/3', text: 'Another reply repeating the same point in slightly different words.' }),
    ];

    const initial = runInterpolatorPipeline({
      rootUri: 'at://thread/test',
      rootText: 'Root post about a policy change.',
      replies,
    });

    const rerun = runInterpolatorPipeline({
      rootUri: 'at://thread/test',
      rootText: 'Root post about a policy change.',
      replies,
      existingState: initial,
    });

    expect(rerun).toBe(initial);
    expect(rerun.version).toBe(1);
  });

  it('updates when a new reply adds meaningful signal', () => {
    const initialReplies = [
      makeReply({ uri: 'at://reply/a', text: 'This is interesting but I want more details.' }),
      makeReply({ uri: 'at://reply/b', text: 'Could you clarify which policy you mean?' }),
    ];

    const initial = runInterpolatorPipeline({
      rootUri: 'at://thread/test',
      rootText: 'Root post about a disputed report.',
      replies: initialReplies,
    });

    const updated = runInterpolatorPipeline({
      rootUri: 'at://thread/test',
      rootText: 'Root post about a disputed report.',
      replies: [
        ...initialReplies,
        makeReply({
          uri: 'at://reply/c',
          text: 'According to the official report, 62 percent of the budget moved last quarter.',
          likeCount: 12,
        }),
      ],
      existingState: initial,
    });

    expect(updated).not.toBe(initial);
    expect(updated.version).toBe(initial.version + 1);
    expect(updated.lastTrigger).not.toBeNull();
  });

  it('still updates when strong new replies arrive during the rate-limit window', () => {
    const initialReplies = [
      makeReply({ uri: 'at://reply/x', text: 'This sounds plausible but needs a source.' }),
      makeReply({ uri: 'at://reply/y', text: 'I am not convinced without official numbers.' }),
    ];

    const initial = runInterpolatorPipeline({
      rootUri: 'at://thread/test',
      rootText: 'Root post about a budget dispute.',
      replies: initialReplies,
    });

    const unchanged = runInterpolatorPipeline({
      rootUri: 'at://thread/test',
      rootText: 'Root post about a budget dispute.',
      replies: initialReplies,
      existingState: initial,
    });

    expect(unchanged).toBe(initial);

    const updated = runInterpolatorPipeline({
      rootUri: 'at://thread/test',
      rootText: 'Root post about a budget dispute.',
      replies: [
        ...initialReplies,
        makeReply({
          uri: 'at://reply/z1',
          text: 'The finance office report shows a 62 percent increase and links the shift to a one-time transfer.',
          likeCount: 14,
        }),
        makeReply({
          uri: 'at://reply/z2',
          text: 'A second reply points to the official spreadsheet and says the shift was recorded in the public ledger.',
          likeCount: 9,
        }),
        makeReply({
          uri: 'at://reply/z3',
          text: 'Another reply says the transfer appears in the quarterly filing and matches the department memo.',
          likeCount: 8,
        }),
      ],
      existingState: unchanged,
    });

    expect(updated).not.toBe(unchanged);
    expect(updated.version).toBe(unchanged.version + 1);
    expect(updated.lastTrigger?.kind).toBe('new_replies');
  });

  it('does not silently advance the cached snapshot when no visible update was accepted', () => {
    const initial = runInterpolatorPipeline({
      rootUri: 'at://thread/test',
      rootText: 'Root post about a budget dispute.',
      replies: [
        makeReply({ uri: 'at://reply/1', text: 'This needs a clearer timeline.' }),
        makeReply({ uri: 'at://reply/2', text: 'I want the numbers behind this claim.' }),
      ],
    });

    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    recordThreadSnapshot('at://thread/test', initial);

    vi.spyOn(Date, 'now').mockReturnValue(70_000);
    const result = detectMeaningfulChange('at://thread/test', initial, 0);
    const snapshotInfo = getThreadSnapshotInfo('at://thread/test');

    expect(result.shouldUpdate).toBe(false);
    expect(snapshotInfo?.age).toBe(69_000);
  });
});
