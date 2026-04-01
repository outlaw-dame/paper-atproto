// ─── ModerationSection ────────────────────────────────────────────────────
// Renders inside the settings sheet. Shows lists of blocked and muted
// accounts with inline unblock/unmute actions.
//
// Timed mutes: the mute form lets users pick a duration;
// the store manages expiry and useTimedMuteWatcher auto-unmutes when expired.

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSessionStore } from '../store/sessionStore';
import {
  useGetBlocks,
  useGetMutes,
  useSubscribedLists,
  useUnmuteList,
  useUnblockList,
  useUnblockActor,
  useUnmuteActor,
  useMuteActor,
  usePreferences,
  useLabelerServices,
  useAddLabeler,
  useRemoveLabeler,
  useRemoveLabelers,
  useSetContentLabelPref,
} from '../lib/atproto/queries';
import { useProfileNavigation } from '../hooks/useProfileNavigation';
import {
  useModerationStore,
  formatMuteExpiry,
  MUTE_DURATIONS,
  type MuteDuration,
} from '../store/moderationStore';
import { atpCall } from '../lib/atproto/client';
import {
  recordLabelPrefWriteAttempt,
  recordLabelPrefWriteFailure,
  recordUnavailableLabelersDetected,
} from '../perf/moderationLabelerTelemetry';

// ─── Styles (inline — consistent with the rest of the settings sheet) ─────
const styles = {
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: 'var(--text-muted)',
    margin: '0 0 10px',
  },
  subsectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    userSelect: 'none' as const,
    padding: '6px 0',
  },
  subsectionTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    background: 'var(--accent)',
    color: '#fff',
    borderRadius: 10,
    padding: '1px 6px',
    minWidth: 18,
    textAlign: 'center' as const,
  },
  chevron: (open: boolean) => ({
    fontSize: 12,
    color: 'var(--text-muted)',
    transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
    transition: 'transform 150ms ease',
  }),
  accountRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 0',
    borderBottom: '1px solid var(--sep)',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    background: 'var(--surface-2)',
    flexShrink: 0,
    overflow: 'hidden' as const,
  },
  accountInfo: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  handle: {
    fontSize: 12,
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  expiryBadge: (expired: boolean) => ({
    fontSize: 11,
    color: expired ? 'var(--destructive)' : 'var(--text-muted)',
    marginTop: 1,
  }),
  actionBtn: (destructive = false) => ({
    fontSize: 12,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 6,
    border: `1px solid ${destructive ? 'var(--destructive)' : 'var(--border)'}`,
    background: 'transparent',
    color: destructive ? 'var(--destructive)' : 'var(--text)',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'opacity 150ms',
  }),
  emptyText: {
    fontSize: 13,
    color: 'var(--text-muted)',
    padding: '8px 0 4px',
    textAlign: 'center' as const,
  },
  muteFormRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 0 4px',
  },
  input: {
    flex: 1,
    fontSize: 13,
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    minWidth: 0,
  },
  select: {
    fontSize: 12,
    padding: '6px 8px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
  },
  submitBtn: {
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    cursor: 'pointer',
    flexShrink: 0,
  },
  listRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '7px 0',
    borderBottom: '1px solid var(--sep)',
  },
  listAvatar: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: 'var(--surface-2)',
    flexShrink: 0,
    overflow: 'hidden' as const,
  },
  listInfo: {
    flex: 1,
    minWidth: 0,
  },
  listName: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  listCreator: {
    fontSize: 12,
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
} as const;

// ─── Actor search result type ─────────────────────────────────────────────
interface ActorSuggestion {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

type LabelVisibility = 'hide' | 'warn' | 'ignore';

interface LabelDefinitionSummary {
  identifier: string;
  name: string;
  description: string;
  defaultSetting: LabelVisibility;
  adultOnly: boolean;
  canWarn: boolean;
  blurs: 'none' | 'content' | 'media';
  severity: 'none' | 'alert' | 'inform';
}

function toTitleCaseLabel(value: string): string {
  return value
    .replace(/^!/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function sanitizeLabelIdentifier(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!/^!?[a-z-]{1,64}$/.test(normalized)) return null;
  return normalized;
}

function normalizeDefaultSetting(raw: unknown): LabelVisibility {
  return raw === 'hide' || raw === 'warn' || raw === 'ignore' ? raw : 'warn';
}

function parseLabelDefinitionsFromService(service: unknown): LabelDefinitionSummary[] {
  const policies = (service as { policies?: unknown } | undefined)?.policies as {
    labelValues?: unknown;
    labelValueDefinitions?: unknown;
  } | undefined;

  const values = Array.isArray(policies?.labelValues) ? policies?.labelValues : [];
  const definitions = Array.isArray(policies?.labelValueDefinitions)
    ? policies?.labelValueDefinitions as Array<{
      identifier?: unknown;
      defaultSetting?: unknown;
      adultOnly?: unknown;
      blurs?: unknown;
      severity?: unknown;
      locales?: unknown;
    }>
    : [];

  const defByIdentifier = new Map<string, LabelDefinitionSummary>();
  for (const def of definitions) {
    const identifier = sanitizeLabelIdentifier(def.identifier);
    if (!identifier) continue;

    const localeEntry = Array.isArray(def.locales)
      ? def.locales.find((entry) => entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string')
      : null;
    const localeName = localeEntry && typeof localeEntry === 'object' ? (localeEntry as { name?: string }).name : undefined;
    const localeDescription = localeEntry && typeof localeEntry === 'object' ? (localeEntry as { description?: string }).description : undefined;
    const blurs = def.blurs === 'none' || def.blurs === 'content' || def.blurs === 'media' ? def.blurs : 'none';
    const severity = def.severity === 'none' || def.severity === 'alert' || def.severity === 'inform' ? def.severity : 'none';

    defByIdentifier.set(identifier, {
      identifier,
      name: (localeName?.trim() || toTitleCaseLabel(identifier)).slice(0, 80),
      description: (localeDescription?.trim() || `Labeled "${identifier}"`).slice(0, 220),
      defaultSetting: normalizeDefaultSetting(def.defaultSetting),
      adultOnly: Boolean(def.adultOnly),
      canWarn: !(blurs === 'none' && severity === 'none'),
      blurs,
      severity,
    });
  }

  for (const value of values) {
    const identifier = sanitizeLabelIdentifier(value);
    if (!identifier || defByIdentifier.has(identifier)) continue;
    defByIdentifier.set(identifier, {
      identifier,
      name: toTitleCaseLabel(identifier),
      description: `Labeled "${identifier}"`,
      defaultSetting: 'warn',
      adultOnly: false,
      canWarn: true,
      blurs: 'none',
      severity: 'inform',
    });
  }

  return [...defByIdentifier.values()].slice(0, 48);
}

function describeLabelBehavior(def: LabelDefinitionSummary, pref: LabelVisibility): string {
  if (pref === 'ignore') {
    if (def.severity === 'inform') return 'Show badge only in relevant surfaces.';
    return 'Label signals are disabled for your view.';
  }

  if (pref === 'warn') {
    if (def.blurs === 'content') return 'Show warning before opening this content.';
    if (def.blurs === 'media') return 'Blur media and allow reveal with warning context.';
    return 'Show warning badge without feed filtering.';
  }

  if (def.blurs === 'content') return 'Filter labeled content from feeds and lists.';
  if (def.blurs === 'media') return 'Filter items and keep sensitive media hidden.';
  return 'Filter labeled items from feeds and discovery surfaces.';
}

// ─── Inline actor-search hook ─────────────────────────────────────────────
// Used by the mute-input to show @handle suggestions.
function useActorSearchSuggestions(query: string) {
  const { agent, session } = useSessionStore();
  const [suggestions, setSuggestions] = useState<ActorSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sanitize before sending to the API.
  const sanitize = (q: string) =>
    q.replace(/[\u0000-\u001F\u007F]/g, '').normalize('NFKC').trim().slice(0, 64);

  useEffect(() => {
    const q = sanitize(query.replace(/^@/, ''));
    if (!q || !session) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    setIsLoading(true);

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      atpCall(
        () => agent.searchActors({ q, limit: 5 }),
        { signal: controller.signal, timeoutMs: 5_000, maxAttempts: 1 },
      )
        .then((res) => {
          if (controller.signal.aborted) return;
          setSuggestions(
            res.data.actors.slice(0, 5).map((a): ActorSuggestion => ({
              did: a.did,
              handle: a.handle,
              ...(a.displayName ? { displayName: a.displayName } : {}),
              ...(a.avatar ? { avatar: a.avatar } : {}),
            })),
          );
          setIsLoading(false);
        })
        .catch((err: unknown) => {
          if ((err as Error | undefined)?.name === 'AbortError') return;
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setIsLoading(false);
        });
    }, 250);

    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [query, agent, session]);

  const dismiss = useCallback(() => {
    setSuggestions([]);
    setIsLoading(false);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);

  return { suggestions, isLoading, dismiss };
}

// ─── Shared actor-suggestion dropdown ─────────────────────────────────────
function ActorSuggestionDropdown({
  suggestions,
  isLoading,
  selectedIndex,
  onSelect,
  onPointerEnterRow,
}: {
  suggestions: ActorSuggestion[];
  isLoading: boolean;
  selectedIndex: number;
  onSelect: (s: ActorSuggestion) => void;
  onPointerEnterRow: (idx: number) => void;
}) {
  if (!isLoading && suggestions.length === 0) return null;

  return (
    <div
      role="listbox"
      aria-label="Account suggestions"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        zIndex: 100,
        marginTop: 3,
        background: 'var(--surface)',
        border: '0.5px solid var(--sep)',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.16)',
        overflow: 'hidden',
      }}
    >
      {isLoading && suggestions.length === 0 && (
        <div style={{ padding: '9px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
          Searching…
        </div>
      )}
      {suggestions.map((s, idx) => {
        const initials = (s.displayName?.[0] ?? s.handle[0] ?? '?').toUpperCase();
        return (
          <button
            key={s.did}
            role="option"
            aria-selected={idx === selectedIndex}
            onPointerEnter={() => onPointerEnterRow(idx)}
            onPointerDown={(e) => {
              // Prevent input blur before selection commits.
              e.preventDefault();
              onSelect(s);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 10px',
              background: idx === selectedIndex ? 'rgba(10,132,255,0.10)' : 'none',
              border: 'none',
              borderBottom: idx < suggestions.length - 1 ? '0.5px solid var(--sep)' : 'none',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.1s ease',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--accent) 0%, #7c5cbf 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                overflow: 'hidden',
              }}
            >
              {s.avatar ? (
                <img
                  src={s.avatar}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                initials
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {s.displayName && (
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.displayName}
                </div>
              )}
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                @{s.handle}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Blocked accounts subsection ─────────────────────────────────────────
function BlockedAccountsSection() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useGetBlocks();
  const { mutate: unblock, isPending: unblocking } = useUnblockActor();

  const blocks = data?.data.blocks ?? [];

  return (
    <div>
      <div style={styles.subsectionHeader} onClick={() => setOpen((p) => !p)} role="button" aria-expanded={open}>
        <span style={styles.subsectionTitle}>
          Blocked accounts
          {blocks.length > 0 && <span style={styles.badge}>{blocks.length}</span>}
        </span>
        <span style={styles.chevron(open)}>›</span>
      </div>

      {open && (
        <div>
          {isLoading && <p style={styles.emptyText}>Loading…</p>}
          {!isLoading && blocks.length === 0 && (
            <p style={styles.emptyText}>No blocked accounts</p>
          )}
          {blocks.map((profile) => (
            <div key={profile.did} style={styles.accountRow}>
              <div style={styles.avatar}>
                {profile.avatar && (
                  <img
                    src={profile.avatar}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
              </div>
              <div style={styles.accountInfo}>
                <div style={styles.displayName}>{profile.displayName || profile.handle}</div>
                <div style={styles.handle}>@{profile.handle}</div>
              </div>
              <button
                style={styles.actionBtn(true)}
                disabled={unblocking}
                onClick={() => unblock({ did: profile.did })}
              >
                Unblock
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Muted accounts subsection ────────────────────────────────────────────
function MutedAccountsSection() {
  const [open, setOpen] = useState(false);
  const [muteHandle, setMuteHandle] = useState('');
  const [muteDuration, setMuteDuration] = useState<MuteDuration>(null);
  const [acSelectedIndex, setAcSelectedIndex] = useState(0);
  const muteInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useGetMutes();
  const { mutate: unmute, isPending: unmuting } = useUnmuteActor();
  const { mutate: mute, isPending: muting } = useMuteActor();
  const timedMutes = useModerationStore((s) => s.timedMutes);

  const mutes = data?.data.mutes ?? [];

  // Actor search autocomplete for the mute input.
  const {
    suggestions: acSuggestions,
    isLoading: acLoading,
    dismiss: acDismiss,
  } = useActorSearchSuggestions(muteHandle);

  // Reset selected index when the suggestion list changes.
  useEffect(() => {
    setAcSelectedIndex(0);
  }, [acSuggestions.length]);

  const handleSelectSuggestion = useCallback(
    (s: ActorSuggestion) => {
      setMuteHandle(s.handle);
      acDismiss();
      muteInputRef.current?.focus();
    },
    [acDismiss],
  );

  const handleMuteInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (acSuggestions.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcSelectedIndex((i) => Math.min(i + 1, acSuggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const s = acSuggestions[acSelectedIndex];
        if (s) {
          e.preventDefault();
          handleSelectSuggestion(s);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        acDismiss();
      }
    },
    [acSuggestions, acSelectedIndex, handleSelectSuggestion, acDismiss],
  );

  function handleMuteSubmit(e: React.FormEvent) {
    e.preventDefault();
    const handle = muteHandle.trim().replace(/^@/, '');
    if (!handle) return;
    acDismiss();
    // handle may be a DID or a handle — the API accepts both via actor parameter
    mute(
      { did: handle, durationMs: muteDuration },
      { onSuccess: () => setMuteHandle('') },
    );
  }

  return (
    <div>
      <div style={styles.subsectionHeader} onClick={() => setOpen((p) => !p)} role="button" aria-expanded={open}>
        <span style={styles.subsectionTitle}>
          Muted accounts
          {mutes.length > 0 && <span style={styles.badge}>{mutes.length}</span>}
        </span>
        <span style={styles.chevron(open)}>›</span>
      </div>

      {open && (
        <div>
          {/* Quick-mute form */}
          <form onSubmit={handleMuteSubmit} style={styles.muteFormRow}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <input
                ref={muteInputRef}
                style={{ ...styles.input, flex: undefined, width: '100%' }}
                placeholder="@handle or DID"
                value={muteHandle}
                onChange={(e) => setMuteHandle(e.target.value)}
                onKeyDown={handleMuteInputKeyDown}
                onBlur={acDismiss}
                disabled={muting}
                aria-label="Account to mute"
                aria-autocomplete="list"
                aria-expanded={acSuggestions.length > 0 || acLoading}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <ActorSuggestionDropdown
                suggestions={acSuggestions}
                isLoading={acLoading}
                selectedIndex={acSelectedIndex}
                onSelect={handleSelectSuggestion}
                onPointerEnterRow={setAcSelectedIndex}
              />
            </div>
            <select
              style={styles.select}
              value={muteDuration ?? 'null'}
              onChange={(e) =>
                setMuteDuration(e.target.value === 'null' ? null : Number(e.target.value))
              }
              aria-label="Mute duration"
            >
              {MUTE_DURATIONS.map((d) => (
                <option key={d.label} value={d.valueMs ?? 'null'}>
                  {d.label}
                </option>
              ))}
            </select>
            <button style={styles.submitBtn} type="submit" disabled={muting || !muteHandle.trim()}>
              Mute
            </button>
          </form>

          {isLoading && <p style={styles.emptyText}>Loading…</p>}
          {!isLoading && mutes.length === 0 && (
            <p style={styles.emptyText}>No muted accounts</p>
          )}
          {mutes.map((profile) => {
            const expiresAt = timedMutes[profile.did] ?? null;
            const isExpired = expiresAt !== null && expiresAt !== 0 && expiresAt < Date.now();
            return (
              <div key={profile.did} style={styles.accountRow}>
                <div style={styles.avatar}>
                  {profile.avatar && (
                    <img
                      src={profile.avatar}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                </div>
                <div style={styles.accountInfo}>
                  <div style={styles.displayName}>{profile.displayName || profile.handle}</div>
                  <div style={styles.handle}>@{profile.handle}</div>
                  {expiresAt !== null && (
                    <div style={styles.expiryBadge(isExpired)}>
                      {formatMuteExpiry(expiresAt)}
                    </div>
                  )}
                </div>
                <button
                  style={styles.actionBtn()}
                  disabled={unmuting}
                  onClick={() => unmute({ did: profile.did })}
                >
                  Unmute
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Moderation lists subsection ─────────────────────────────────────────
function ModerationListsSection() {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useSubscribedLists();
  const { mutate: unmuteList, isPending: unmutingList } = useUnmuteList();
  const { mutate: unblockList, isPending: unblockingList } = useUnblockList();

  const mutedLists = data?.muted ?? [];
  const blockedLists = data?.blocked ?? [];
  const totalCount = mutedLists.length + blockedLists.length;

  return (
    <div>
      <div style={styles.subsectionHeader} onClick={() => setOpen((p) => !p)} role="button" aria-expanded={open}>
        <span style={styles.subsectionTitle}>
          Moderation lists
          {totalCount > 0 && <span style={styles.badge}>{totalCount}</span>}
        </span>
        <span style={styles.chevron(open)}>›</span>
      </div>

      {open && (
        <div>
          {isLoading && <p style={styles.emptyText}>Loading…</p>}

          {!isLoading && (
            <>
              <p style={{ margin: '8px 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Muted lists
              </p>
              {mutedLists.length === 0 ? (
                <p style={styles.emptyText}>No muted lists</p>
              ) : (
                mutedLists.map((list) => (
                  <div key={list.uri} style={styles.listRow}>
                    <div style={styles.listAvatar}>
                      {list.avatar && (
                        <img
                          src={list.avatar}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      )}
                    </div>
                    <div style={styles.listInfo}>
                      <div style={styles.listName}>{list.name}</div>
                      <div style={styles.listCreator}>@{list.creator.handle}</div>
                    </div>
                    <button
                      style={styles.actionBtn()}
                      disabled={unmutingList}
                      onClick={() => unmuteList({ listUri: list.uri })}
                    >
                      Unmute
                    </button>
                  </div>
                ))
              )}

              <p style={{ margin: '10px 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Blocked lists
              </p>
              {blockedLists.length === 0 ? (
                <p style={styles.emptyText}>No blocked lists</p>
              ) : (
                blockedLists.map((list) => (
                  <div key={list.uri} style={styles.listRow}>
                    <div style={styles.listAvatar}>
                      {list.avatar && (
                        <img
                          src={list.avatar}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      )}
                    </div>
                    <div style={styles.listInfo}>
                      <div style={styles.listName}>{list.name}</div>
                      <div style={styles.listCreator}>@{list.creator.handle}</div>
                    </div>
                    <button
                      style={styles.actionBtn(true)}
                      disabled={unblockingList}
                      onClick={() => unblockList({ listUri: list.uri })}
                    >
                      Unblock
                    </button>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LabelersSection() {
  const { agent } = useSessionStore();
  const navigateToProfile = useProfileNavigation();
  const [open, setOpen] = useState(false);
  const [labelerInput, setLabelerInput] = useState('');
  const [acSelectedIndex, setAcSelectedIndex] = useState(0);
  const [expandedLabelerDid, setExpandedLabelerDid] = useState<string | null>(null);
  const [labelPrefError, setLabelPrefError] = useState<string | null>(null);
  const [labelPrefSuccess, setLabelPrefSuccess] = useState<string | null>(null);
  const [optimisticLabelPrefs, setOptimisticLabelPrefs] = useState<Record<string, LabelVisibility>>({});
  const [pendingPrefWrites, setPendingPrefWrites] = useState<Record<string, true>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSuccessAtRef = useRef(0);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: preferencesData, isLoading: preferencesLoading } = usePreferences();
  const { mutate: addLabeler, isPending: addingLabeler } = useAddLabeler();
  const { mutate: removeLabeler, isPending: removingLabeler } = useRemoveLabeler();
  const { mutate: removeLabelers, isPending: removingManyLabelers } = useRemoveLabelers();
  const { mutate: setContentLabelPref } = useSetContentLabelPref();

  const labelerPrefs = useMemo(
    () => (preferencesData?.moderationPrefs?.labelers ?? []) as Array<{ did: string }>,
    [preferencesData],
  );
  const labelerDids = useMemo(
    () => labelerPrefs.map((entry) => entry.did).filter(Boolean),
    [labelerPrefs],
  );
  const { data: servicesData, isLoading: servicesLoading } = useLabelerServices(labelerDids);

  const serviceViews = (servicesData?.data?.views ?? []) as Array<{
    creator?: { did?: string; handle?: string; displayName?: string; avatar?: string };
    policies?: unknown;
  }>;
  const serviceByDid = useMemo(() => {
    const byDid = new Map<string, { handle?: string; displayName?: string; avatar?: string; definitions: LabelDefinitionSummary[] }>();
    for (const view of serviceViews) {
      const did = view.creator?.did;
      if (!did) continue;
      byDid.set(did, {
        ...(view.creator?.handle ? { handle: view.creator.handle } : {}),
        ...(view.creator?.displayName ? { displayName: view.creator.displayName } : {}),
        ...(view.creator?.avatar ? { avatar: view.creator.avatar } : {}),
        definitions: parseLabelDefinitionsFromService(view),
      });
    }
    return byDid;
  }, [serviceViews]);

  const {
    suggestions: acSuggestions,
    isLoading: acLoading,
    dismiss: acDismiss,
  } = useActorSearchSuggestions(labelerInput);

  useEffect(() => {
    setAcSelectedIndex(0);
  }, [acSuggestions.length]);

  const unavailableDids = useMemo(
    () => labelerDids.filter((did) => !serviceByDid.has(did)),
    [labelerDids, serviceByDid],
  );

  useEffect(() => {
    recordUnavailableLabelersDetected(unavailableDids.length);
  }, [unavailableDids.length]);

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const showRateLimitedSuccess = useCallback((message: string) => {
    const now = Date.now();
    if (now - lastSuccessAtRef.current < 1_500) return;
    lastSuccessAtRef.current = now;
    setLabelPrefSuccess(message);
    if (successTimerRef.current !== null) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => {
      setLabelPrefSuccess(null);
      successTimerRef.current = null;
    }, 2_200);
  }, []);

  const handleSelectSuggestion = useCallback(
    (s: ActorSuggestion) => {
      setLabelerInput(s.did);
      acDismiss();
      inputRef.current?.focus();
    },
    [acDismiss],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (acSuggestions.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAcSelectedIndex((i) => Math.min(i + 1, acSuggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAcSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const s = acSuggestions[acSelectedIndex];
        if (s) {
          e.preventDefault();
          handleSelectSuggestion(s);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        acDismiss();
      }
    },
    [acDismiss, acSelectedIndex, acSuggestions, handleSelectSuggestion],
  );

  function handleAddLabelerSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = labelerInput.trim();
    if (!trimmed) return;
    acDismiss();
    const directDid = trimmed.startsWith('did:') ? trimmed : null;

    const commitAdd = (did: string) => {
      if (labelerDids.includes(did)) {
        setLabelerInput('');
        return;
      }
      setLabelPrefError(null);
      addLabeler(
        { did },
        { onSuccess: () => setLabelerInput('') },
      );
    };

    if (directDid) {
      commitAdd(directDid);
      return;
    }

    void atpCall(() => agent.searchActors({ q: trimmed.replace(/^@/, ''), limit: 1 }))
      .then((res) => {
        const did = res.data.actors[0]?.did;
        if (!did) return;
        commitAdd(did);
      })
      .catch(() => {
        // Ignore resolution failures and keep input for correction.
      });
  }

  const isLoading = preferencesLoading || (labelerDids.length > 0 && servicesLoading);
  const adultContentEnabled = Boolean(preferencesData?.moderationPrefs?.adultContentEnabled);

  return (
    <div>
      <div style={styles.subsectionHeader} onClick={() => setOpen((p) => !p)} role="button" aria-expanded={open}>
        <span style={styles.subsectionTitle}>
          Labelers
          {labelerDids.length > 0 && <span style={styles.badge}>{labelerDids.length}</span>}
        </span>
        <span style={styles.chevron(open)}>›</span>
      </div>

      {open && (
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.35 }}>
            Subscribe to trusted labelers to apply their moderation labels, similar to Bluesky labeler controls.
          </p>
          {unavailableDids.length > 0 && (
            <div style={{ marginBottom: 10, border: '1px solid var(--sep)', borderRadius: 10, padding: '8px 10px', background: 'var(--fill-1)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--label-2)', lineHeight: 1.35 }}>
                Some moderation services are unavailable right now.
              </p>
              <button
                style={{ ...styles.actionBtn(true), marginTop: 8 }}
                disabled={removingManyLabelers}
                onClick={() => removeLabelers({ dids: unavailableDids })}
              >
                Remove unavailable services
              </button>
            </div>
          )}
          <form onSubmit={handleAddLabelerSubmit} style={styles.muteFormRow}>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <input
                ref={inputRef}
                style={{ ...styles.input, flex: undefined, width: '100%' }}
                placeholder="Labeler DID or @handle"
                value={labelerInput}
                onChange={(e) => setLabelerInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
                onBlur={acDismiss}
                disabled={addingLabeler}
                aria-label="Labeler to add"
                aria-autocomplete="list"
                aria-expanded={acSuggestions.length > 0 || acLoading}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <ActorSuggestionDropdown
                suggestions={acSuggestions}
                isLoading={acLoading}
                selectedIndex={acSelectedIndex}
                onSelect={handleSelectSuggestion}
                onPointerEnterRow={setAcSelectedIndex}
              />
            </div>
            <button style={styles.submitBtn} type="submit" disabled={addingLabeler || !labelerInput.trim()}>
              Add
            </button>
          </form>
          {labelPrefError && (
            <p role="alert" aria-live="polite" style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--destructive)' }}>
              {labelPrefError}
            </p>
          )}
          {labelPrefSuccess && (
            <p aria-live="polite" style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--green)' }}>
              {labelPrefSuccess}
            </p>
          )}

          {isLoading && <p style={styles.emptyText}>Loading…</p>}
          {!isLoading && labelerDids.length === 0 && (
            <p style={styles.emptyText}>No labelers configured</p>
          )}
          {labelerDids.map((did) => {
            const view = serviceByDid.get(did);
            const handle = view?.handle;
            const display = view?.displayName || handle || did;
            const labelRules = labelerPrefs.find((entry) => entry.did === did)?.labels;
            const labelRuleCount = labelRules ? Object.keys(labelRules).length : 0;
            const definitions = view?.definitions ?? [];
            const isExpanded = expandedLabelerDid === did;
            return (
              <div key={did}>
                <div style={styles.accountRow}>
                  <div style={styles.avatar}>
                    {view?.avatar && (
                      <img
                        src={view.avatar}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    )}
                  </div>
                  <div style={styles.accountInfo}>
                    <div style={styles.displayName}>{display}</div>
                    <div style={styles.handle}>{handle ? `@${handle}` : did}</div>
                    {labelRuleCount > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {labelRuleCount} label preference{labelRuleCount === 1 ? '' : 's'}
                      </div>
                    )}
                  </div>
                  <button
                    style={styles.actionBtn()}
                    onClick={() => {
                      void navigateToProfile(did);
                    }}
                  >
                    View
                  </button>
                  {definitions.length > 0 && (
                    <button
                      style={styles.actionBtn()}
                      onClick={() => setExpandedLabelerDid((current) => current === did ? null : did)}
                    >
                      {isExpanded ? 'Hide labels' : 'Configure labels'}
                    </button>
                  )}
                  <button
                    style={styles.actionBtn(true)}
                    disabled={removingLabeler || removingManyLabelers}
                    onClick={() => removeLabeler({ did })}
                  >
                    Remove
                  </button>
                </div>
                {isExpanded && definitions.length > 0 && (
                  <div style={{ margin: '2px 0 10px 42px', border: '1px solid var(--sep)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
                    {definitions.map((def, index) => {
                      const prefKey = `${did}:${def.identifier}`;
                      const persistedPref = (labelRules?.[def.identifier] as LabelVisibility | undefined)
                        ?? def.defaultSetting;
                      const currentPref = optimisticLabelPrefs[prefKey] ?? persistedPref;
                      const forcedHide = def.adultOnly && !adultContentEnabled;
                      const effectivePref: LabelVisibility = forcedHide ? 'hide' : currentPref;
                      const options: LabelVisibility[] = def.canWarn ? ['hide', 'warn', 'ignore'] : ['hide', 'ignore'];
                      const settingDisabled = forcedHide || pendingPrefWrites[prefKey] === true;

                      return (
                        <div key={`${did}:${def.identifier}`} style={{ padding: '8px 10px', borderTop: index > 0 ? '1px solid var(--sep)' : 'none' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{def.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{def.description}</div>
                          {forcedHide && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                              Adult content is disabled, so this label is forced to Hide.
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                            {options.map((option) => {
                              const active = effectivePref === option;
                              const optionLabel = option === 'ignore' ? 'Show' : option[0].toUpperCase() + option.slice(1);
                              return (
                                <button
                                  key={option}
                                  style={{
                                    borderRadius: 999,
                                    border: active ? '1px solid var(--blue)' : '1px solid var(--sep)',
                                    background: active ? 'color-mix(in srgb, var(--blue) 14%, var(--surface))' : 'var(--fill-1)',
                                    color: active ? 'var(--blue)' : 'var(--text)',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: '4px 10px',
                                    cursor: settingDisabled ? 'default' : 'pointer',
                                    opacity: settingDisabled ? 0.65 : 1,
                                  }}
                                  disabled={settingDisabled}
                                  onClick={() => {
                                    const safeIdentifier = sanitizeLabelIdentifier(def.identifier);
                                    if (!safeIdentifier) {
                                      setLabelPrefError('Invalid label identifier. Please refresh and try again.');
                                      return;
                                    }
                                    if (effectivePref === option) return;
                                    setLabelPrefError(null);
                                    setOptimisticLabelPrefs((prev) => ({ ...prev, [prefKey]: option }));
                                    setPendingPrefWrites((prev) => ({ ...prev, [prefKey]: true }));
                                    recordLabelPrefWriteAttempt();
                                    setContentLabelPref(
                                      { label: safeIdentifier, visibility: option, labelerDid: did },
                                      {
                                        onSuccess: () => {
                                          setOptimisticLabelPrefs((prev) => {
                                            const next = { ...prev };
                                            delete next[prefKey];
                                            return next;
                                          });
                                          showRateLimitedSuccess(`Saved ${def.name} preference.`);
                                        },
                                        onError: () => {
                                          recordLabelPrefWriteFailure();
                                          setOptimisticLabelPrefs((prev) => {
                                            const next = { ...prev };
                                            delete next[prefKey];
                                            return next;
                                          });
                                          setLabelPrefError('Could not save label preference. Please retry.');
                                        },
                                        onSettled: () => {
                                          setPendingPrefWrites((prev) => {
                                            const next = { ...prev };
                                            delete next[prefKey];
                                            return next;
                                          });
                                        },
                                      },
                                    );
                                  }}
                                >
                                  {optionLabel}
                                </button>
                              );
                            })}
                          </div>
                          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                            {describeLabelBehavior(def, effectivePref)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Root export ─────────────────────────────────────────────────────────
export default function ModerationSection() {
  const { session } = useSessionStore();
  if (!session) return null;

  return (
    <section>
      <p style={styles.sectionTitle}>Moderation</p>
      <BlockedAccountsSection />
      <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '4px 0' }} />
      <MutedAccountsSection />
      <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '4px 0' }} />
      <ModerationListsSection />
      <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '4px 0' }} />
      <LabelersSection />
    </section>
  );
}
