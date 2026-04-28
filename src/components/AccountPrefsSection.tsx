import React, { useState } from 'react';
import { usePreferences, useSetThreadViewPrefs, useSetFeedViewPrefs } from '../lib/atproto/queries';
import { useSessionStore } from '../store/sessionStore';

const THREAD_SORT_OPTIONS = [
  { value: 'oldest',     label: 'Oldest first' },
  { value: 'newest',     label: 'Newest first' },
  { value: 'most-likes', label: 'Most liked first' },
  { value: 'hotness',    label: 'Hotness' },
] as const;

function ToggleRow({
  label,
  helper,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  helper?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 12,
      padding: '8px 0',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
    }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-1)' }}>{label}</span>
        {helper && (
          <span style={{ fontSize: 11, lineHeight: 1.35, color: 'var(--label-3)' }}>{helper}</span>
        )}
      </span>
      <span style={{
        width: 42,
        height: 26,
        borderRadius: 999,
        background: checked ? 'var(--blue)' : 'var(--fill-3)',
        border: `1px solid ${checked ? 'color-mix(in srgb, var(--blue) 70%, #000 30%)' : 'var(--sep)'}`,
        position: 'relative',
        transition: 'all 0.16s ease',
        flexShrink: 0,
      }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => { if (!disabled) onChange(e.target.checked); }}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
          aria-label={label}
        />
        <span style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.22)',
          transition: 'left 0.16s ease',
        }} />
      </span>
    </label>
  );
}

export default function AccountPrefsSection() {
  const { session } = useSessionStore();
  const { data: prefs, isLoading } = usePreferences();
  const setThreadPrefs = useSetThreadViewPrefs();
  const setFeedPrefs = useSetFeedViewPrefs();

  const [savedLabel, setSavedLabel] = useState<string | null>(null);

  if (!session) return null;

  const showSaved = (msg: string) => {
    setSavedLabel(msg);
    setTimeout(() => setSavedLabel(null), 2200);
  };

  const isSaving = setThreadPrefs.isPending || setFeedPrefs.isPending;

  const threadSort = prefs?.threadViewPrefs.sort ?? 'oldest';
  // Upstream preferences use 'home' as the key for Following feed view settings
  const homePrefs: {
    hideReplies?: boolean;
    hideRepliesByUnfollowed?: boolean;
    hideReposts?: boolean;
    hideQuotePosts?: boolean;
  } = prefs?.feedViewPrefs['home'] ?? {};

  const handleThreadSort = (sort: string) => {
    setThreadPrefs.mutate({ sort }, {
      onSuccess: () => showSaved('Saved'),
      onError: () => showSaved('Save failed'),
    });
  };

  const handleFeedPref = (key: string, value: boolean) => {
    setFeedPrefs.mutate({ feed: 'home', pref: { [key]: value } }, {
      onSuccess: () => showSaved('Saved'),
      onError: () => showSaved('Save failed'),
    });
  };

  return (
    <div style={{ marginTop: 14 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>Feed &amp; conversation</h4>
        {savedLabel && (
          <span style={{ fontSize: 11, fontWeight: 600, color: savedLabel === 'Save failed' ? 'var(--red)' : 'var(--green)' }}>
            {savedLabel}
          </span>
        )}
        {isSaving && !savedLabel && (
          <span style={{ fontSize: 11, color: 'var(--label-4)' }}>Saving…</span>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35, marginBottom: 10 }}>
        Synced to your account — takes effect across your connected clients.
      </p>

      {isLoading ? (
        <p style={{ fontSize: 12, color: 'var(--label-4)', padding: '6px 0' }}>Loading preferences…</p>
      ) : (
        <>
          {/* ── Thread sort ── */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--label-3)', marginBottom: 6 }}>
              Conversation sort order
            </label>
            <select
              value={threadSort}
              onChange={(e) => handleThreadSort(e.target.value)}
              disabled={isSaving}
              style={{
                width: '100%',
                height: 36,
                borderRadius: 10,
                border: '1px solid var(--sep)',
                background: 'var(--fill-1)',
                color: 'var(--label-1)',
                padding: '0 10px',
                fontSize: 13,
                opacity: isSaving ? 0.6 : 1,
              }}
            >
              {THREAD_SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* ── Following feed view ── */}
          <div style={{ borderTop: '1px solid var(--sep)', paddingTop: 4 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--label-3)', marginBottom: 0, paddingTop: 6 }}>
              Following feed
            </p>
            <ToggleRow
              label="Hide replies"
              helper="Don't show reply posts in the Following feed."
              checked={homePrefs.hideReplies ?? false}
              onChange={(v) => handleFeedPref('hideReplies', v)}
              disabled={isSaving}
            />
            <ToggleRow
              label="Hide replies from non-followed"
              helper="Only show replies from people you follow."
              checked={homePrefs.hideRepliesByUnfollowed ?? false}
              onChange={(v) => handleFeedPref('hideRepliesByUnfollowed', v)}
              disabled={isSaving}
            />
            <ToggleRow
              label="Hide reposts"
              helper="Remove reposted content from the Following feed."
              checked={homePrefs.hideReposts ?? false}
              onChange={(v) => handleFeedPref('hideReposts', v)}
              disabled={isSaving}
            />
            <ToggleRow
              label="Hide quote posts"
              helper="Hide posts that quote other posts."
              checked={homePrefs.hideQuotePosts ?? false}
              onChange={(v) => handleFeedPref('hideQuotePosts', v)}
              disabled={isSaving}
            />
          </div>
        </>
      )}
    </div>
  );
}
