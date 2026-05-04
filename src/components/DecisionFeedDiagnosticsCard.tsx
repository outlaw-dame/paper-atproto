import React from 'react';
import {
  getDecisionFeedSnapshot,
  subscribeToDecisionFeed,
} from '../intelligence/coordinator/decisionFeed';
import { deriveDecisionFeedHealth } from './decisionFeedDiagnostics';

interface DecisionFeedDiagnosticsCardProps {
  supportsClientTelemetry: boolean;
}

export default function DecisionFeedDiagnosticsCard(
  props: DecisionFeedDiagnosticsCardProps,
) {
  const { supportsClientTelemetry } = props;
  const [snapshot, setSnapshot] = React.useState(() => getDecisionFeedSnapshot());

  React.useEffect(() => {
    if (!supportsClientTelemetry) return () => {};
    setSnapshot(getDecisionFeedSnapshot());
    return subscribeToDecisionFeed(() => {
      setSnapshot(getDecisionFeedSnapshot());
    });
  }, [supportsClientTelemetry]);

  const summary = React.useMemo(
    () => deriveDecisionFeedHealth(snapshot),
    [snapshot],
  );

  const statusColor = summary.status === 'degraded'
    ? 'var(--red, #d14b4b)'
    : summary.status === 'watch'
      ? 'var(--yellow, #c58b16)'
      : summary.status === 'healthy'
        ? 'var(--green, #228b5a)'
        : 'var(--label-3)';

  return (
    <div
      style={{
        border: '1px solid var(--sep)',
        borderRadius: 8,
        padding: '8px 10px',
        background: 'var(--fill-1)',
        display: 'grid',
        gap: 4,
      }}
    >
      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: 'var(--label-1)' }}>
        Unified lane decision feed
      </p>
      {!supportsClientTelemetry ? (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
          Feed diagnostics are visible only in local telemetry mode.
        </p>
      ) : (
        <>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.45,
              color: statusColor,
            }}
          >
            {summary.headline}
          </p>
          {summary.details.map((detail) => (
            <p key={detail} style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
              {detail}
            </p>
          ))}
          {summary.recent.length > 0 && (
            <div style={{ display: 'grid', gap: 4, marginTop: 2 }}>
              {summary.recent.map((record) => (
                <p key={record.decisionId} style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
                  {record.surface} • {Math.round(record.durationMs)} ms • {record.reasonCodes.join(', ') || 'no_reason_codes'}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
