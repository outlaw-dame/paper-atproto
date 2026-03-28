// ─── ModerationSection ────────────────────────────────────────────────────
// Renders inside the settings sheet. Shows lists of blocked and muted
// accounts with inline unblock/unmute actions.
//
// Timed mutes: the mute form lets users pick a duration;
// the store manages expiry and useTimedMuteWatcher auto-unmutes when expired.

import { useState } from 'react';
import { useSessionStore } from '../store/sessionStore.js';
import {
  useGetBlocks,
  useGetMutes,
  useUnblockActor,
  useUnmuteActor,
  useMuteActor,
} from '../lib/atproto/queries.js';
import {
  useModerationStore,
  formatMuteExpiry,
  MUTE_DURATIONS,
  type MuteDuration,
} from '../store/moderationStore.js';

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
} as const;

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

  const { data, isLoading } = useGetMutes();
  const { mutate: unmute, isPending: unmuting } = useUnmuteActor();
  const { mutate: mute, isPending: muting } = useMuteActor();
  const timedMutes = useModerationStore((s) => s.timedMutes);

  const mutes = data?.data.mutes ?? [];

  function handleMuteSubmit(e: React.FormEvent) {
    e.preventDefault();
    const handle = muteHandle.trim().replace(/^@/, '');
    if (!handle) return;
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
            <input
              style={styles.input}
              placeholder="@handle or DID"
              value={muteHandle}
              onChange={(e) => setMuteHandle(e.target.value)}
              disabled={muting}
              aria-label="Account to mute"
            />
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
    </section>
  );
}
