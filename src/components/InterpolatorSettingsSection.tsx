import React from 'react';
import { useInterpolatorSettingsStore } from '../store/interpolatorSettingsStore';

export default function InterpolatorSettingsSection() {
  const enabled = useInterpolatorSettingsStore((state) => state.enabled);
  const setEnabled = useInterpolatorSettingsStore((state) => state.setEnabled);

  return (
    <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: '10px', background: 'var(--fill-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-2)' }}>
            AI Interpolator
          </p>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
            Show AI-generated conversation summaries and thread interpretation context.
          </p>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          <span style={{
            width: 42,
            height: 26,
            borderRadius: 999,
            background: enabled ? 'var(--blue)' : 'var(--fill-3)',
            border: `1px solid ${enabled ? 'color-mix(in srgb, var(--blue) 70%, #000 30%)' : 'var(--sep)'}`,
            position: 'relative',
            transition: 'all 0.16s ease',
            flexShrink: 0,
          }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
              aria-label="Enable AI Interpolator"
            />
            <span style={{
              position: 'absolute',
              top: 2,
              left: enabled ? 18 : 2,
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(0,0,0,0.22)',
              transition: 'left 0.16s ease',
            }} />
          </span>
        </label>
      </div>

      {!enabled && (
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--label-3)' }}>
          AI Interpolator is off. Conversation summaries will be hidden until re-enabled.
        </p>
      )}
    </div>
  );
}
