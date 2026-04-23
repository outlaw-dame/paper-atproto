import React from 'react';
import { useUiStore } from '../../store/uiStore';
import { useInterpolatorSettingsStore } from '../../store/interpolatorSettingsStore';
import { useConversationSessionStore } from '../../conversation/sessionStore';

export function InterpretiveInspector() {
  const enabled = useInterpolatorSettingsStore((state) => state.showInterpretiveInspector);
  const storyId = useUiStore((state) => state.story?.id ?? null);
  const explanation = useConversationSessionStore((state) => {
    if (!storyId) return null;
    return state.byId[storyId]?.interpretation.interpretiveExplanation ?? null;
  });

  if (!import.meta.env.DEV || !enabled || !explanation?.v2) return null;

  return (
    <aside
      aria-label="Interpretive Inspector"
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        width: 'min(420px, calc(100vw - 24px))',
        maxHeight: 'min(520px, calc(100vh - 40px))',
        overflow: 'auto',
        background: 'rgba(12, 14, 18, 0.94)',
        color: '#f8fafc',
        fontSize: 12,
        padding: 14,
        borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 18px 60px rgba(0,0,0,0.38)',
        zIndex: 9999,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <h4 style={{ margin: 0, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Interpretive Inspector
        </h4>
        <span style={{ color: '#94a3b8' }}>v{explanation.v2.schemaVersion}</span>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gap: 3, color: '#cbd5e1' }}>
        <div><strong style={{ color: '#fff' }}>Score:</strong> {explanation.score.toFixed(2)}</div>
        <div><strong style={{ color: '#fff' }}>Mode:</strong> {explanation.mode}</div>
        <div><strong style={{ color: '#fff' }}>Primary:</strong> {explanation.v2.primaryReasons.join(', ') || 'none'}</div>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
        {explanation.v2.contributions.map((contribution) => (
          <div
            key={contribution.factor}
            style={{
              borderRadius: 10,
              background: contribution.direction === 'support'
                ? 'rgba(34,197,94,0.10)'
                : 'rgba(248,113,113,0.10)',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '8px 9px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong>{contribution.factor}</strong>
              <span>{contribution.evidence?.magnitude ?? 'low'}</span>
            </div>
            <div style={{ marginTop: 4, color: '#cbd5e1' }}>
              delta {contribution.delta.toFixed(3)} | {contribution.direction} | {contribution.severity}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
