import React, { useEffect, useState } from 'react';
import { useSensitiveMediaStore } from '../store/sensitiveMediaStore';
import { getSensitiveMediaMetricsSnapshot } from '../perf/sensitiveMediaTelemetry';

export default function SensitiveMediaSection() {
  const { policy, setPolicy, clearReveals, revealedPostIds } = useSensitiveMediaStore();
  const [metrics, setMetrics] = useState(() => getSensitiveMediaMetricsSnapshot());

  useEffect(() => {
    const timer = setInterval(() => setMetrics(getSensitiveMediaMetricsSnapshot()), 1500);
    return () => clearInterval(timer);
  }, []);

  const confirmResetReveals = () => {
    const revealedCount = Object.keys(revealedPostIds).length;
    if (revealedCount === 0) return;
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      clearReveals();
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to reset ${revealedCount} reveal${revealedCount === 1 ? '' : 's'} for this device?`,
    );
    if (!confirmed) return;
    clearReveals();
  };

  return (
    <div>
      <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)', marginBottom: 4 }}>
        Sensitive media
      </h4>
      <p style={{ fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35, marginBottom: 10 }}>
        Blur media flagged as sexual content, nudity, or graphic violence. Reveal is local to your device and can be reset anytime.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--label-2)', fontWeight: 600 }}>Blur sensitive media</span>
          <input
            type="checkbox"
            checked={policy.blurSensitiveMedia}
            onChange={(e) => setPolicy({ blurSensitiveMedia: e.target.checked })}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--label-2)', fontWeight: 600 }}>Allow tap-to-reveal</span>
          <input
            type="checkbox"
            checked={policy.allowReveal}
            onChange={(e) => setPolicy({ allowReveal: e.target.checked })}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--label-2)', fontWeight: 600 }}>Share anonymous telemetry</span>
          <input
            type="checkbox"
            checked={policy.telemetryOptIn}
            onChange={(e) => setPolicy({ telemetryOptIn: e.target.checked })}
          />
        </label>
      </div>

      <p style={{ fontSize: 11, color: 'var(--label-4)', marginTop: 8, lineHeight: 1.35 }}>
        Telemetry never includes text, media URLs, handles, DIDs, or post IDs.
      </p>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
          <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Impressions</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{metrics.impressions}</div>
        </div>
        <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }}>
          <div style={{ fontSize: 11, color: 'var(--label-3)' }}>Reveals</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }}>{metrics.reveals}</div>
        </div>
      </div>

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--label-3)' }}>
          Revealed posts this session: {Object.keys(revealedPostIds).length}
        </span>
        <button
          type="button"
          onClick={confirmResetReveals}
          style={{
            border: '1px solid var(--sep)',
            borderRadius: 8,
            background: 'var(--fill-1)',
            color: 'var(--label-2)',
            fontSize: 11,
            fontWeight: 700,
            padding: '4px 8px',
            cursor: 'pointer',
          }}
        >
          Reset reveals
        </button>
      </div>
    </div>
  );
}
