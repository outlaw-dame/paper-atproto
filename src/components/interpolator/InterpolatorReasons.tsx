import React from 'react';
import { humanizeInterpretiveFactorId } from '../../conversation/interpretive/interpretiveExplanation';
import type { InterpretiveFactorId } from '../../conversation/sessionTypes';

export function labelForInterpretiveReason(reason: InterpretiveFactorId): string {
  return humanizeInterpretiveFactorId(reason);
}

export function InterpolatorReasons({
  reasons,
}: {
  reasons?: InterpretiveFactorId[] | undefined;
}) {
  const visibleReasons = reasons?.slice(0, 3) ?? [];
  if (visibleReasons.length === 0) return null;

  return (
    <div
      aria-label="Why this interpretation is routed this way"
      style={{
        display: 'flex',
        gap: 7,
        flexWrap: 'wrap',
        margin: '-4px 0 12px',
      }}
    >
      {visibleReasons.map((reason) => (
        <span
          key={reason}
          style={{
            padding: '4px 9px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.08)',
            border: '0.5px solid rgba(255,255,255,0.14)',
            color: 'rgba(255,255,255,0.76)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.01em',
          }}
        >
          {labelForInterpretiveReason(reason)}
        </span>
      ))}
    </div>
  );
}
