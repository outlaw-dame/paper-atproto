import React from 'react';
import { selectAiStackProfile } from '../runtime/aiStackProfile';
import { chooseModelForTask, type TaskKind } from '../runtime/modelPolicy';
import { buildRouterCoordinatorDiagnosticsSnapshot } from '../runtime/routerCoordinatorDiagnostics';
import { useRuntimeStore } from '../runtime/runtimeStore';

const DIAGNOSTIC_TASKS: TaskKind[] = ['text_generation', 'multimodal_analysis', 'hot_path_scoring'];

function formatEnum(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatRouteAllowed(allowed: boolean): string {
  return allowed ? 'allowed' : 'blocked';
}

export default function RouterCoordinatorDiagnosticsCard() {
  const capability = useRuntimeStore((state) => state.capability);
  const settingsMode = useRuntimeStore((state) => state.settingsMode);
  const allowLiteRt = useRuntimeStore((state) => state.allowLiteRt);
  const preferLiteRt = useRuntimeStore((state) => state.preferLiteRt);
  const userConsentedToLargeModels = useRuntimeStore((state) => state.userConsentedToLargeModels);

  const snapshots = React.useMemo(() => {
    if (!capability) return [];
    const stackProfile = selectAiStackProfile(capability, {
      settingsMode,
      allowLiteRt,
      preferLiteRt,
      userConsentedToLargeModels,
    });

    return DIAGNOSTIC_TASKS.map((task) => {
      const policyDecision = chooseModelForTask({ capability, settingsMode, task });
      return buildRouterCoordinatorDiagnosticsSnapshot({ policyDecision, stackProfile });
    });
  }, [allowLiteRt, capability, preferLiteRt, settingsMode, userConsentedToLargeModels]);

  return (
    <div
      style={{
        border: '1px solid var(--sep)',
        borderRadius: 10,
        padding: '10px 12px',
        background: 'var(--surface, #fff)',
        display: 'grid',
        gap: 10,
      }}
    >
      <div>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: 'var(--label-1)' }}>
          Router/coordinator shadow diagnostics
        </p>
        <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
          Read-only contract diagnostics. These snapshots do not invoke router/coordinator models or change routing.
        </p>
      </div>

      {snapshots.length === 0 ? (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
          Capability probe has not finished yet. Router/coordinator diagnostics are unavailable until runtime capability is known.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {snapshots.map((snapshot) => (
            <div
              key={snapshot.task}
              style={{
                border: '1px solid var(--sep)',
                borderRadius: 10,
                padding: '9px 10px',
                display: 'grid',
                gap: 5,
                background: 'var(--surface, #fff)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {formatEnum(snapshot.task)}
                </span>
                <span style={{ fontSize: 11, color: snapshot.readiness === 'blocked' ? 'var(--orange, #a86413)' : 'var(--label-3)' }}>
                  {formatEnum(snapshot.readiness)}
                </span>
              </div>

              <div style={{ fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
                <p style={{ margin: 0 }}>
                  Default route: <strong>{snapshot.defaultRouteId}</strong> • fallback: <strong>{snapshot.fallbackRouteId}</strong>
                </p>
                <p style={{ margin: '4px 0 0' }}>
                  Policy: {snapshot.policy.choice} • local {snapshot.policy.localAllowed ? 'allowed' : 'blocked'} • remote fallback {snapshot.policy.remoteFallbackAllowed ? 'allowed' : 'blocked'}
                </p>
                <p style={{ margin: '4px 0 0' }}>
                  Stack: {formatEnum(snapshot.stack.tier)} / {snapshot.stack.runtime} • router {snapshot.stack.routerModel} • coordinator {snapshot.stack.coordinatorModel}
                  {snapshot.stack.coordinatorRequiresConsent ? ' • coordinator requires consent' : ''}
                </p>
                <p style={{ margin: '4px 0 0' }}>
                  Blockers: {snapshot.blockers.length > 0 ? snapshot.blockers.map(formatEnum).join(' • ') : 'none'}
                </p>
                <p style={{ margin: '4px 0 0' }}>
                  Routes: {snapshot.allowedRoutes.map((route) => `${route.id} (${formatRouteAllowed(route.allowed)})`).join(' • ')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
