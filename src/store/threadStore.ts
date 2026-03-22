// ─── Rolling Thread State Store (Pipeline B) ─────────────────────────────
// Implements the Narwhal-style rolling conversation state.
// Each thread has a ThreadState that is updated incrementally as new replies
// arrive and as user feedback signals are collected.
//
// The state is keyed by post AT URI and persists across StoryMode opens.

import { create } from 'zustand';
import type { ThreadNode } from '../lib/resolver/atproto';

// ─── Contribution role labels (Narwhal-style) ─────────────────────────────
export type ContributionRole =
  | 'clarifying'       // adds clarity to the discussion
  | 'new_information'  // introduces a fact or angle not yet present
  | 'direct_response'  // directly addresses the original post
  | 'repetitive'       // repeats something already said
  | 'provocative'      // raises heat without adding signal
  | 'useful_counterpoint' // good-faith disagreement with evidence
  | 'story_worthy'     // notable enough to surface in a story card
  | 'unknown';         // not yet scored

// ─── Per-reply score ──────────────────────────────────────────────────────
export interface ReplyScore {
  uri: string;
  role: ContributionRole;
  usefulnessScore: number;  // 0–1
  abuseScore: number;       // 0–1 (Detoxify-style)
  userFeedback?: 'clarifying' | 'new_to_me' | 'provocative' | 'aha';
  scoredAt: string;         // ISO timestamp
}

// ─── Rolling thread state ─────────────────────────────────────────────────
export interface ThreadState {
  rootUri: string;
  summaryText: string;
  salientClaims: string[];
  salientContributors: string[];  // DIDs
  clarificationsAdded: string[];  // brief descriptions
  newAnglesAdded: string[];
  repetitionLevel: number;        // 0–1
  heatLevel: number;              // 0–1 (conflict/derailment)
  sourceSupportPresent: boolean;
  replyScores: Record<string, ReplyScore>;  // keyed by reply URI
  updatedAt: string;              // ISO timestamp of last state update
  version: number;                // incremented on each update
}

// ─── Store ────────────────────────────────────────────────────────────────
interface ThreadStoreState {
  threads: Record<string, ThreadState>;  // keyed by root post URI

  // Initialize or reset a thread state when a thread is first opened
  initThread: (rootUri: string) => void;

  // Update the rolling summary (called after scoring new replies)
  updateSummary: (rootUri: string, patch: Partial<Omit<ThreadState, 'rootUri' | 'version'>>) => void;

  // Record a reply score
  setReplyScore: (rootUri: string, score: ReplyScore) => void;

  // Record user feedback on a reply
  setUserFeedback: (rootUri: string, replyUri: string, feedback: ReplyScore['userFeedback']) => void;

  // Get thread state (or null if not yet initialized)
  getThread: (rootUri: string) => ThreadState | null;
}

function emptyThreadState(rootUri: string): ThreadState {
  return {
    rootUri,
    summaryText: '',
    salientClaims: [],
    salientContributors: [],
    clarificationsAdded: [],
    newAnglesAdded: [],
    repetitionLevel: 0,
    heatLevel: 0,
    sourceSupportPresent: false,
    replyScores: {},
    updatedAt: new Date().toISOString(),
    version: 0,
  };
}

export const useThreadStore = create<ThreadStoreState>((set, get) => ({
  threads: {},

  initThread: (rootUri) => {
    set(state => {
      if (state.threads[rootUri]) return state; // already exists
      return { threads: { ...state.threads, [rootUri]: emptyThreadState(rootUri) } };
    });
  },

  updateSummary: (rootUri, patch) => {
    set(state => {
      const existing = state.threads[rootUri] ?? emptyThreadState(rootUri);
      return {
        threads: {
          ...state.threads,
          [rootUri]: {
            ...existing,
            ...patch,
            updatedAt: new Date().toISOString(),
            version: existing.version + 1,
          },
        },
      };
    });
  },

  setReplyScore: (rootUri, score) => {
    set(state => {
      const existing = state.threads[rootUri] ?? emptyThreadState(rootUri);
      return {
        threads: {
          ...state.threads,
          [rootUri]: {
            ...existing,
            replyScores: { ...existing.replyScores, [score.uri]: score },
            updatedAt: new Date().toISOString(),
            version: existing.version + 1,
          },
        },
      };
    });
  },

  setUserFeedback: (rootUri, replyUri, feedback) => {
    set(state => {
      const existing = state.threads[rootUri];
      if (!existing) return state;
      const existingScore = existing.replyScores[replyUri];
      if (!existingScore) return state;
      return {
        threads: {
          ...state.threads,
          [rootUri]: {
            ...existing,
            replyScores: {
              ...existing.replyScores,
              [replyUri]: { ...existingScore, userFeedback: feedback },
            },
            updatedAt: new Date().toISOString(),
            version: existing.version + 1,
          },
        },
      };
    });
  },

  getThread: (rootUri) => get().threads[rootUri] ?? null,
}));

// ─── Lightweight heuristic scorer ─────────────────────────────────────────
// This is the Phase 1 placeholder for the SetFit classifier.
// It uses simple heuristics to assign a contribution role and usefulness score
// to a reply, based on the reply's text and its relationship to the thread.
// In Phase 2, this will be replaced by a SetFit model running in the worker.

export function heuristicScoreReply(
  replyText: string,
  threadTexts: string[],
  likeCount: number
): ReplyScore {
  const text = replyText.toLowerCase();
  const words = text.split(/\s+/).length;

  // Simple signals
  const hasQuestion = text.includes('?');
  const hasLink = /https?:\/\//.test(text);
  const isShort = words < 8;
  const isVeryShort = words < 4;
  const hasAgreement = /\b(agree|exactly|yes|correct|right|true)\b/.test(text);
  const hasDisagreement = /\b(disagree|wrong|actually|but|however|no)\b/.test(text);
  const hasClarification = /\b(clarif|mean|explain|what do you|could you)\b/.test(text);

  // Check repetition: is this text very similar to an existing thread text?
  const isRepetitive = threadTexts.some(t => {
    const overlap = text.split(/\s+/).filter(w => t.toLowerCase().includes(w)).length;
    return overlap / words > 0.6;
  });

  let role: ContributionRole = 'unknown';
  let usefulnessScore = 0.5;

  if (isRepetitive) {
    role = 'repetitive';
    usefulnessScore = 0.1;
  } else if (hasClarification || hasQuestion) {
    role = 'clarifying';
    usefulnessScore = 0.7;
  } else if (hasDisagreement && hasLink) {
    role = 'useful_counterpoint';
    usefulnessScore = 0.85;
  } else if (hasDisagreement) {
    role = 'provocative';
    usefulnessScore = 0.4;
  } else if (hasLink) {
    role = 'new_information';
    usefulnessScore = 0.75;
  } else if (hasAgreement && isShort) {
    role = 'repetitive';
    usefulnessScore = 0.2;
  } else if (words > 30) {
    role = 'direct_response';
    usefulnessScore = 0.65;
  }

  // Boost by engagement
  if (likeCount > 10) usefulnessScore = Math.min(1, usefulnessScore + 0.1);
  if (likeCount > 50) usefulnessScore = Math.min(1, usefulnessScore + 0.15);

  // Very short replies are rarely useful
  if (isVeryShort) usefulnessScore = Math.min(usefulnessScore, 0.25);

  return {
    uri: '',  // caller fills this in
    role,
    usefulnessScore,
    abuseScore: 0,  // Phase 2: Detoxify
    scoredAt: new Date().toISOString(),
  };
}

// ─── Build rolling summary from scored replies ─────────────────────────────
export function buildRollingSummary(
  rootText: string,
  replies: ThreadNode[],
  scores: Record<string, ReplyScore>
): Partial<ThreadState> {
  const salientClaims: string[] = [rootText.slice(0, 120)];
  const salientContributors: string[] = [];
  const clarificationsAdded: string[] = [];
  const newAnglesAdded: string[] = [];
  let repetitionLevel = 0;
  let heatLevel = 0;
  let sourceSupportPresent = false;

  const sortedReplies = [...replies].sort((a, b) => {
    const sa = scores[a.uri]?.usefulnessScore ?? 0;
    const sb = scores[b.uri]?.usefulnessScore ?? 0;
    return sb - sa;
  });

  for (const reply of sortedReplies) {
    const score = scores[reply.uri];
    if (!score) continue;

    if (score.role === 'repetitive') {
      repetitionLevel = Math.min(1, repetitionLevel + 0.15);
      continue;
    }
    if (score.role === 'provocative') {
      heatLevel = Math.min(1, heatLevel + 0.2);
    }
    if (score.role === 'clarifying') {
      clarificationsAdded.push(reply.text.slice(0, 80));
    }
    if (score.role === 'new_information' || score.role === 'useful_counterpoint') {
      newAnglesAdded.push(reply.text.slice(0, 80));
    }
    if (reply.embed?.kind === 'external') {
      sourceSupportPresent = true;
    }
    if (score.usefulnessScore > 0.6 && !salientContributors.includes(reply.authorDid)) {
      salientContributors.push(reply.authorDid);
    }
  }

  // Build a simple summary text
  const parts: string[] = [];
  if (clarificationsAdded.length > 0) parts.push(`${clarificationsAdded.length} clarification${clarificationsAdded.length > 1 ? 's' : ''} added`);
  if (newAnglesAdded.length > 0) parts.push(`${newAnglesAdded.length} new angle${newAnglesAdded.length > 1 ? 's' : ''} introduced`);
  if (sourceSupportPresent) parts.push('sources cited');
  if (heatLevel > 0.4) parts.push('some heat in the thread');

  const summaryText = parts.length > 0
    ? `This discussion has ${parts.join(', ')}.`
    : 'Discussion is still developing.';

  return {
    summaryText,
    salientClaims,
    salientContributors,
    clarificationsAdded,
    newAnglesAdded,
    repetitionLevel,
    heatLevel,
    sourceSupportPresent,
  };
}
