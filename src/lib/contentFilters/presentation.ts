import type { PostFilterMatch } from './types';

export type WarnMatchReason = {
  phrase: string;
  reason: 'exact' | 'semantic' | 'exact+semantic';
};

function describeMatchKinds(matchKinds: Set<PostFilterMatch['matchType']>): string {
  const hasKeyword = matchKinds.has('keyword');
  const hasSemantic = matchKinds.has('semantic');
  if (hasKeyword && hasSemantic) return 'exact + semantic';
  if (hasSemantic) return 'semantic';
  return 'exact';
}

export function warnMatchLabels(matches: PostFilterMatch[]): string[] {
  return warnMatchReasons(matches).map((entry) => `${entry.phrase} (${entry.reason.replace('+', ' + ')})`);
}

export function warnMatchReasons(matches: PostFilterMatch[]): WarnMatchReason[] {
  const phraseKinds = new Map<string, Set<PostFilterMatch['matchType']>>();

  for (const match of matches) {
    if (match.action !== 'warn') continue;
    const phrase = match.phrase.trim();
    if (!phrase) continue;

    const existing = phraseKinds.get(phrase) ?? new Set<PostFilterMatch['matchType']>();
    existing.add(match.matchType);
    phraseKinds.set(phrase, existing);
  }

  return [...phraseKinds.entries()].map(([phrase, kinds]) => {
    const kind = describeMatchKinds(kinds);
    if (kind === 'semantic') {
      return { phrase, reason: 'semantic' };
    }
    if (kind === 'exact + semantic') {
      return { phrase, reason: 'exact+semantic' };
    }
    return { phrase, reason: 'exact' };
  });
}