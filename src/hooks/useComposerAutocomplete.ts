// ─── Composer Autocomplete ─────────────────────────────────────────────────
// Detects @mention and #hashtag triggers in a textarea and manages suggestion
// state. Designed for use in ComposeSheet.
//
// @mention  → debounced actor search via Bluesky API (250 ms, AbortController)
// #hashtag  → instant local filter over trending / recent / favorite tags
//
// Security:
//   • Query strings are sanitized (control chars stripped, length capped)
//     before every API call.
//   • The fetch is cancelled when the component unmounts or the trigger changes.
//   • maxAttempts:1 prevents retry storms on autocomplete requests.

import { useState, useCallback, useRef, useEffect } from 'react';
import type { BskyAgent } from '@atproto/api';
import { atpCall } from '../lib/atproto/client';

// ─── Public types ───────────────────────────────────────────────────────────

export interface MentionCandidate {
  type: 'mention';
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface HashtagCandidate {
  type: 'hashtag';
  tag: string;
  isTrending: boolean;
}

export type AutocompleteCandidate = MentionCandidate | HashtagCandidate;

export interface UseComposerAutocompleteOptions {
  agent: BskyAgent;
  /** Trending topic slugs (no # prefix) loaded from the Bluesky API. */
  trendingTopics: string[];
  /** Recently-used hashtags from localStorage. */
  recentHashtags: string[];
  /** Favorited hashtags from localStorage. */
  favoriteHashtags: string[];
  /**
   * Called when a candidate is accepted. Provides the fully-replaced text
   * and the new cursor position so the parent can update its state.
   */
  onInsertCompletion: (newText: string, newCursor: number) => void;
}

export interface UseComposerAutocompleteReturn {
  /** Whether the dropdown is open (there are candidates or a fetch is in flight). */
  isOpen: boolean;
  candidates: AutocompleteCandidate[];
  selectedIndex: number;
  setSelectedIndex: (idx: number) => void;
  isLoading: boolean;
  triggerType: 'mention' | 'hashtag' | null;
  /** Call from the textarea's onChange handler. */
  notifyTextChange: (text: string, cursor: number) => void;
  /** Call from the textarea's onKeyDown handler. Returns true when the key
   *  was consumed (caller should call e.preventDefault()). */
  onKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    currentText: string,
    currentCursor: number,
  ) => boolean;
  /** Dismiss without selecting. */
  dismiss: () => void;
  /** Select a candidate by index or reference (used by pointer interactions). */
  select: (candidate: AutocompleteCandidate, currentText: string, currentCursor: number) => void;
}

// ─── Internal types ─────────────────────────────────────────────────────────

interface TriggerContext {
  type: 'mention' | 'hashtag';
  /** Text after the trigger character up to the cursor. */
  query: string;
  /** Character index of the @ or # in the text string. */
  start: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Scans backward from `cursor` to find an @mention or #hashtag trigger.
 * Returns null if the cursor is not inside a trigger context.
 */
function findTrigger(text: string, cursor: number): TriggerContext | null {
  if (cursor === 0) return null;

  let i = cursor - 1;
  while (i >= 0) {
    const ch = text[i];

    if (ch === '@' || ch === '#') {
      // Trigger must be at start-of-string or preceded by whitespace.
      const prev = i > 0 ? text[i - 1] : null;
      if (prev !== null && !/[\s\n]/.test(prev as string)) return null;

      const query = text.slice(i + 1, cursor);

      // Query can only contain identifier characters; reject otherwise.
      if (query.length > 0 && !/^[\w.\-]*$/.test(query)) return null;

      // Prevent absurdly long queries from reaching the API.
      if (query.length > 64) return null;

      return { type: ch === '@' ? 'mention' : 'hashtag', query, start: i };
    }

    // Whitespace terminates the search — there is no trigger in this word.
    if (/[\s\n]/.test(ch!)) return null;

    i -= 1;
  }

  return null;
}

/**
 * Strip control characters and limit length before sending to the API.
 */
function sanitizeQuery(q: string): string {
  return q
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .normalize('NFKC')
    .trim()
    .slice(0, 64);
}

/**
 * Filters the local hashtag pool by the given prefix query.
 * Deduplicates, prioritises recents, then favorites, then trending.
 */
function filterHashtags(
  query: string,
  recents: string[],
  favorites: string[],
  trending: string[],
): HashtagCandidate[] {
  const q = query.toLowerCase();
  const trendingSet = new Set(trending.map((t) => t.toLowerCase()));
  const seen = new Set<string>();
  const results: HashtagCandidate[] = [];

  const pool = [...recents, ...favorites, ...trending];
  for (const raw of pool) {
    const lower = raw.toLowerCase();
    if (seen.has(lower)) continue;
    if (q !== '' && !lower.startsWith(q)) continue;
    seen.add(lower);
    results.push({ type: 'hashtag', tag: raw, isTrending: trendingSet.has(lower) });
    if (results.length >= 6) break;
  }

  return results;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useComposerAutocomplete({
  agent,
  trendingTopics,
  recentHashtags,
  favoriteHashtags,
  onInsertCompletion,
}: UseComposerAutocompleteOptions): UseComposerAutocompleteReturn {
  const [trigger, setTrigger] = useState<TriggerContext | null>(null);
  const [candidates, setCandidates] = useState<AutocompleteCandidate[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Stable refs to avoid stale-closure bugs in async callbacks.
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep stable references to hashtag arrays so the mention-fetch effect
  // doesn't unnecessarily re-run when those lists are regenerated.
  const recentRef = useRef(recentHashtags);
  const favRef = useRef(favoriteHashtags);
  const trendingRef = useRef(trendingTopics);
  useEffect(() => { recentRef.current = recentHashtags; }, [recentHashtags]);
  useEffect(() => { favRef.current = favoriteHashtags; }, [favoriteHashtags]);
  useEffect(() => { trendingRef.current = trendingTopics; }, [trendingTopics]);

  const cancelPending = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  // Clean up on unmount.
  useEffect(() => cancelPending, [cancelPending]);

  const dismiss = useCallback(() => {
    cancelPending();
    setTrigger(null);
    setCandidates([]);
    setSelectedIndex(0);
    setIsLoading(false);
  }, [cancelPending]);

  const notifyTextChange = useCallback(
    (text: string, cursor: number) => {
      const ctx = findTrigger(text, cursor);

      setTrigger(ctx);
      setSelectedIndex(0);

      if (!ctx) {
        cancelPending();
        setCandidates([]);
        setIsLoading(false);
        return;
      }

      // ── Hashtag: instant local filter ──────────────────────────────────
      if (ctx.type === 'hashtag') {
        cancelPending();
        setCandidates(
          filterHashtags(ctx.query, recentRef.current, favRef.current, trendingRef.current),
        );
        setIsLoading(false);
        return;
      }

      // ── Mention: debounced API call ─────────────────────────────────────
      const q = sanitizeQuery(ctx.query);
      if (!q) {
        cancelPending();
        setCandidates([]);
        setIsLoading(false);
        return;
      }

      cancelPending();
      setIsLoading(true);

      debounceRef.current = setTimeout(() => {
        const controller = new AbortController();
        abortRef.current = controller;

        atpCall(
          () => agent.searchActors({ q, limit: 8 }),
          { signal: controller.signal, timeoutMs: 5_000, maxAttempts: 1 },
        )
          .then((res) => {
            if (controller.signal.aborted) return;
            const actors = res.data.actors.slice(0, 6);
            setCandidates(
              actors.map(
                (a): MentionCandidate => ({
                  type: 'mention',
                  did: a.did,
                  handle: a.handle,
                  ...(a.displayName ? { displayName: a.displayName } : {}),
                  ...(a.avatar ? { avatar: a.avatar } : {}),
                }),
              ),
            );
            setIsLoading(false);
          })
          .catch((err: unknown) => {
            if (controller.signal.aborted) return;
            const name = (err as Error | undefined)?.name ?? '';
            if (name === 'AbortError') return;
            // Silence autocomplete errors — they are non-critical.
            setCandidates([]);
            setIsLoading(false);
          });
      }, 250);
    },
    [agent, cancelPending],
  );

  const select = useCallback(
    (candidate: AutocompleteCandidate, currentText: string, currentCursor: number) => {
      if (!trigger) return;

      const insertion =
        candidate.type === 'mention'
          ? `@${candidate.handle} `
          : `#${candidate.tag} `;

      // Replace from the trigger character to the current cursor.
      const newText =
        currentText.slice(0, trigger.start) + insertion + currentText.slice(currentCursor);
      const newCursor = trigger.start + insertion.length;

      onInsertCompletion(newText, newCursor);
      dismiss();
    },
    [trigger, onInsertCompletion, dismiss],
  );

  const onKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLTextAreaElement>,
      currentText: string,
      currentCursor: number,
    ): boolean => {
      if (!trigger || candidates.length === 0) return false;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, candidates.length - 1));
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const candidate = candidates[selectedIndex];
        if (candidate) {
          e.preventDefault();
          select(candidate, currentText, currentCursor);
          return true;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
        return true;
      }

      return false;
    },
    [trigger, candidates, selectedIndex, select, dismiss],
  );

  const isOpen = trigger !== null && (candidates.length > 0 || isLoading);

  return {
    isOpen,
    candidates,
    selectedIndex,
    setSelectedIndex,
    isLoading,
    triggerType: trigger?.type ?? null,
    notifyTextChange,
    onKeyDown,
    dismiss,
    select,
  };
}
