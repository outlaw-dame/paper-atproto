// ─── Apple Settings Section ───────────────────────────────────────────────────
// Settings section for push notification preferences and iCloud convenience sync.
// Rendered inside a settings/profile page — not a standalone route.
//
// Visibility:
//   • Push section: shown whenever push is supported (not denied)
//   • iCloud section: shown only when likelyAppleWebKit is true
//
// The iCloud disclosure copy explicitly explains what IS and IS NOT synced,
// so users can make an informed opt-in decision.

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppleEnhancementStore } from '../store/appleEnhancementStore';
import { usePushPreferencesStore } from '../pwa/push/pushPreferencesStore';
import { getPushCapability } from '../pwa/push/pushCapability';
import { ensurePushSubscription, disablePushSubscription } from '../pwa/push/pushSubscription';
import { initializeCloudKit } from '../apple/cloudkit/auth';

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({
  on,
  onChange,
  disabled = false,
  label,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => !disabled && onChange(!on)}
      style={{
        appearance: 'none',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        width: 51,
        height: 31,
        borderRadius: 999,
        background: on
          ? 'var(--green, #34C759)'
          : 'var(--label-4, rgba(60, 60, 67, 0.18))',
        position: 'relative',
        flexShrink: 0,
        transition: 'background 0.20s',
        opacity: disabled ? 0.45 : 1,
        WebkitTapHighlightColor: 'transparent',
        padding: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 22 : 2,
          width: 27,
          height: 27,
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.24)',
          transition: 'left 0.18s cubic-bezier(0.25, 0.1, 0.25, 1)',
        }}
      />
    </button>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: '0 0 6px 4px',
        fontSize: 13,
        fontFamily: 'var(--font-ui)',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--label-3)',
      }}
    >
      {children}
    </h3>
  );
}

// ─── Row separator ────────────────────────────────────────────────────────────

function Sep() {
  return (
    <div
      aria-hidden="true"
      style={{ height: '0.5px', background: 'var(--sep)', marginLeft: 58 }}
    />
  );
}

// ─── Settings row ─────────────────────────────────────────────────────────────

function SettingsRow({
  icon,
  label,
  sublabel,
  right,
  topRadius = false,
  bottomRadius = false,
}: {
  icon?: React.ReactNode;
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
  topRadius?: boolean;
  bottomRadius?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        background: 'var(--surface, #ffffff)',
        borderTopLeftRadius: topRadius ? 14 : 0,
        borderTopRightRadius: topRadius ? 14 : 0,
        borderBottomLeftRadius: bottomRadius ? 14 : 0,
        borderBottomRightRadius: bottomRadius ? 14 : 0,
        minHeight: 50,
      }}
    >
      {icon !== undefined && (
        <div
          aria-hidden="true"
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'color-mix(in srgb, var(--blue, #007AFF) 12%, transparent)',
            color: 'var(--blue, #007AFF)',
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 16,
            fontFamily: 'var(--font-ui)',
            color: 'var(--label-1)',
            fontWeight: 400,
            lineHeight: 1.3,
          }}
        >
          {label}
        </p>
        {sublabel !== undefined && (
          <p
            style={{
              margin: '2px 0 0',
              fontSize: 12,
              fontFamily: 'var(--font-ui)',
              color: 'var(--label-3)',
              lineHeight: 1.4,
            }}
          >
            {sublabel}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AppleSettingsSection() {
  const availability = useAppleEnhancementStore((s) => s.availability);
  const cloudKitEnabled = useAppleEnhancementStore((s) => s.cloudKitEnabled);
  const cloudKitSyncState = useAppleEnhancementStore((s) => s.cloudKitSyncState);
  const cloudKitErrorMessage = useAppleEnhancementStore((s) => s.cloudKitErrorMessage);
  const setCloudKitEnabled = useAppleEnhancementStore((s) => s.setCloudKitEnabled);
  const setCloudKitSyncState = useAppleEnhancementStore((s) => s.setCloudKitSyncState);

  const pushPrefs = usePushPreferencesStore();

  // Refresh capability lazily — only runs once on mount, not on every keystroke
  const [cap, setCap] = React.useState(() => getPushCapability());
  React.useEffect(() => {
    setCap(getPushCapability());
  }, []);

  const [pushLoading, setPushLoading] = React.useState(false);
  const [cloudKitLoading, setCloudKitLoading] = React.useState(false);

  const handlePushMasterToggle = React.useCallback(
    async (value: boolean) => {
      if (pushLoading) return;
      setPushLoading(true);
      try {
        if (value) {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') return;
          const result = await ensurePushSubscription();
          if (result.ok) {
            pushPrefs.setEnabled(true);
          }
        } else {
          await disablePushSubscription();
          pushPrefs.setEnabled(false);
        }
      } catch {
        // Non-fatal: user sees toggle revert to previous state
      } finally {
        setPushLoading(false);
        setCap(getPushCapability());
      }
    },
    [pushLoading, pushPrefs],
  );

  const handleCloudKitToggle = React.useCallback(
    async (value: boolean) => {
      if (cloudKitLoading) return;

      if (!value) {
        setCloudKitEnabled(false);
        return;
      }

      setCloudKitLoading(true);
      setCloudKitEnabled(true);

      try {
        const authState = await initializeCloudKit({ interactive: true });
        if (!authState.ready) {
          setCloudKitSyncState('unavailable', authState.errorCode ?? 'config-missing');
          return;
        }
        if (!authState.signedIn) {
          setCloudKitSyncState('unavailable', authState.errorCode ?? 'not-signed-in');
          return;
        }
        setCloudKitSyncState('syncing');
      } catch (error) {
        setCloudKitSyncState('error', getCloudKitFailureCode(error));
      } finally {
        setCloudKitLoading(false);
      }
    },
    [cloudKitLoading, setCloudKitEnabled, setCloudKitSyncState],
  );

  const showPush = cap.supported && cap.permission !== 'denied';
  const showApple = availability?.likelyAppleWebKit === true;

  if (!showPush && !showApple) return null;

  const cloudKitSubLabel =
    cloudKitLoading || cloudKitSyncState === 'syncing'
      ? 'Syncing…'
      : cloudKitSyncState === 'error'
      ? describeCloudKitStatus(cloudKitErrorMessage, 'error')
      : cloudKitSyncState === 'unavailable'
      ? describeCloudKitStatus(cloudKitErrorMessage, 'unavailable')
      : 'Reading position, appearance preferences';

  return (
    <div
      style={{
        padding: '0 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
      }}
    >
      {/* ── Push notifications ─────────────────────────────────────────────── */}
      {showPush && (
        <section aria-labelledby="settings-notifications-heading">
          <SectionHeader>
            <span id="settings-notifications-heading">Notifications</span>
          </SectionHeader>

          <div
            style={{
              borderRadius: 14,
              border: '0.5px solid var(--sep)',
              overflow: 'hidden',
            }}
          >
            {/* Master toggle */}
            <SettingsRow
              topRadius
              bottomRadius={!pushPrefs.enabled}
              icon={<BellIcon />}
              label="Push notifications"
              sublabel={
                cap.permission === 'denied'
                  ? 'Blocked — allow in system Settings'
                  : pushPrefs.enabled
                  ? 'On'
                  : 'Off'
              }
              right={
                <Toggle
                  on={pushPrefs.enabled}
                  onChange={handlePushMasterToggle}
                  disabled={pushLoading || cap.permission === 'denied'}
                  label="Toggle push notifications"
                />
              }
            />

            {/* Per-type preference rows — animated in/out */}
            <AnimatePresence initial={false}>
              {pushPrefs.enabled && (
                <motion.div
                  key="prefs"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <Sep />
                  <SettingsRow
                    icon={<AtIcon />}
                    label="Mentions"
                    right={
                      <Toggle
                        on={pushPrefs.mentions}
                        onChange={pushPrefs.setMentions}
                        label="Mentions notifications"
                      />
                    }
                  />
                  <Sep />
                  <SettingsRow
                    icon={<ReplyIcon />}
                    label="Replies"
                    right={
                      <Toggle
                        on={pushPrefs.replies}
                        onChange={pushPrefs.setReplies}
                        label="Reply notifications"
                      />
                    }
                  />
                  <Sep />
                  <SettingsRow
                    icon={<PersonAddIcon />}
                    label="New followers"
                    right={
                      <Toggle
                        on={pushPrefs.follows}
                        onChange={pushPrefs.setFollows}
                        label="New follower notifications"
                      />
                    }
                  />
                  <Sep />
                  <SettingsRow
                    icon={<MessageIcon />}
                    label="Direct messages"
                    right={
                      <Toggle
                        on={pushPrefs.dms}
                        onChange={pushPrefs.setDms}
                        label="Direct message notifications"
                      />
                    }
                  />
                  <Sep />
                  <SettingsRow
                    icon={<ShieldIcon />}
                    label="Moderation alerts"
                    right={
                      <Toggle
                        on={pushPrefs.moderation}
                        onChange={pushPrefs.setModeration}
                        label="Moderation alert notifications"
                      />
                    }
                  />
                  <Sep />
                  <SettingsRow
                    bottomRadius
                    icon={<DigestIcon />}
                    label="Daily digest"
                    sublabel="Activity summary delivered once per day"
                    right={
                      <Toggle
                        on={pushPrefs.digest}
                        onChange={pushPrefs.setDigest}
                        label="Daily digest notifications"
                      />
                    }
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      )}

      {/* ── iCloud convenience sync ────────────────────────────────────────── */}
      {showApple && (
        <section aria-labelledby="settings-apple-heading">
          <SectionHeader>
            <span id="settings-apple-heading">Apple Integration</span>
          </SectionHeader>

          <div
            style={{
              borderRadius: 14,
              border: '0.5px solid var(--sep)',
              overflow: 'hidden',
            }}
          >
            <SettingsRow
              topRadius
              bottomRadius={!cloudKitEnabled}
              icon={<CloudIcon />}
              label="iCloud convenience sync"
              sublabel={cloudKitSubLabel}
              right={
                <Toggle
                  on={cloudKitEnabled}
                  onChange={handleCloudKitToggle}
                  disabled={cloudKitSyncState === 'syncing' || cloudKitLoading}
                  label="Toggle iCloud convenience sync"
                />
              }
            />

            <AnimatePresence initial={false}>
              {cloudKitEnabled && (
                <motion.div
                  key="ck-detail"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <div
                    style={{
                      padding: '10px 16px 14px',
                      borderTop: '0.5px solid var(--sep)',
                      borderBottomLeftRadius: 14,
                      borderBottomRightRadius: 14,
                      background: 'var(--surface)',
                    }}
                  >
                    {/* What IS synced */}
                    <p
                      style={{
                        margin: '0 0 6px',
                        fontSize: 12,
                        fontFamily: 'var(--font-ui)',
                        color: 'var(--label-2)',
                        fontWeight: 600,
                        lineHeight: 1.4,
                      }}
                    >
                      Synced to iCloud (optional convenience only):
                    </p>
                    <ul
                      style={{
                        margin: '0 0 10px',
                        padding: '0 0 0 16px',
                        fontSize: 12,
                        fontFamily: 'var(--font-ui)',
                        color: 'var(--label-3)',
                        lineHeight: 1.6,
                      }}
                    >
                      <li>Reading position across your Apple devices</li>
                      <li>Appearance preferences (layout, density)</li>
                      <li>Draft recovery snapshots (AES-256 encrypted end-to-end)</li>
                    </ul>

                    {/* What is NOT synced */}
                    <p
                      style={{
                        margin: '0 0 6px',
                        fontSize: 12,
                        fontFamily: 'var(--font-ui)',
                        color: 'var(--label-2)',
                        fontWeight: 600,
                        lineHeight: 1.4,
                      }}
                    >
                      Never synced to iCloud:
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        padding: '0 0 0 16px',
                        fontSize: 12,
                        fontFamily: 'var(--font-ui)',
                        color: 'var(--label-3)',
                        lineHeight: 1.6,
                      }}
                    >
                      <li>Account credentials or session tokens</li>
                      <li>Posts, follows, likes, bookmarks, or moderation state</li>
                      <li>Any ATProto protocol records</li>
                    </ul>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

function AtIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
    </svg>
  );
}

function ReplyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 00-4-4H4" />
    </svg>
  );
}

function PersonAddIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  );
}

function MessageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function DigestIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function CloudIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" />
    </svg>
  );
}

function getCloudKitFailureCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return 'cloudkit-unknown';
}

function describeCloudKitStatus(
  code: string | null,
  state: 'error' | 'unavailable',
): string {
  switch (code) {
    case 'config-missing':
      return 'Unavailable until CloudKit env is configured';
    case 'cloudkit-config':
      return 'CloudKit is misconfigured';
    case 'cloudkit-transport':
      return 'Could not reach iCloud right now — retry later';
    case 'script-not-loaded':
    case 'cloudkit-unknown':
      return state === 'error'
        ? 'CloudKit failed to start — retry later'
        : 'CloudKit not available in this browser session';
    case 'not-signed-in':
    case 'cloudkit-auth':
      return 'Sign in to iCloud to enable';
    default:
      return state === 'error' ? 'Sync error — toggle to retry' : 'Sign in to iCloud to enable';
  }
}
