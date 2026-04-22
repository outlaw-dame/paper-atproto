import type { AppBskyActorDefs } from '@atproto/api';
import { atpCall } from './atproto/client';
import { hybridSearch } from '../search';

type HybridAuthorRow = {
  author_did?: string;
  authorDid?: string;
  rrf_score?: number;
  rrfScore?: number;
};

function uniqueDidCandidates(rows: HybridAuthorRow[], maxDids: number): string[] {
  const scoreByDid = new Map<string, number>();
  for (const row of rows) {
    const rawDid = String(row?.author_did || row?.authorDid || '').trim();
    if (!rawDid.startsWith('did:')) continue;
    const score = Number(row?.rrf_score ?? row?.rrfScore ?? 0);
    const existing = scoreByDid.get(rawDid);
    if (existing === undefined || score > existing) {
      scoreByDid.set(rawDid, score);
    }
  }

  return [...scoreByDid.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxDids)
    .map(([did]) => did);
}

export async function searchSemanticPeople(
  agent: any,
  query: string,
  options?: { rowLimit?: number; maxProfiles?: number },
): Promise<AppBskyActorDefs.ProfileView[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const rowLimit = Math.max(8, options?.rowLimit ?? 40);
  const maxProfiles = Math.max(4, options?.maxProfiles ?? 12);

  const hybridRes = await hybridSearch.search(trimmed, rowLimit).catch(() => null);
  const dids = uniqueDidCandidates((hybridRes?.rows ?? []) as HybridAuthorRow[], maxProfiles);
  if (dids.length === 0) return [];

  // Use the batched endpoint (up to 25 DIDs per call) rather than N individual fetches.
  const res = await atpCall(
    () => agent.app.bsky.actor.getProfiles({ actors: dids }),
  ).catch(() => null) as { data?: { profiles?: AppBskyActorDefs.ProfileView[] } } | null;

  const profiles: AppBskyActorDefs.ProfileView[] = [];
  for (const profile of res?.data?.profiles ?? []) {
    if (!profile?.did || !profile?.handle) continue;
    profiles.push(profile as AppBskyActorDefs.ProfileView);
  }
  return profiles;
}

export function mergePeopleCandidates(
  primary: AppBskyActorDefs.ProfileView[],
  secondary: AppBskyActorDefs.ProfileView[],
): AppBskyActorDefs.ProfileView[] {
  const seen = new Set<string>();
  const merged: AppBskyActorDefs.ProfileView[] = [];

  for (const actor of [...primary, ...secondary]) {
    const key = actor?.did?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(actor);
  }

  return merged;
}