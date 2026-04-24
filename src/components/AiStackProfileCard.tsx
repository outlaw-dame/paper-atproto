import React from 'react';
import {
  getBackgroundUpgradeCandidate,
  selectAiStackProfile,
  type AiModelBinding,
  type AiStackProfile,
} from '../runtime/aiStackProfile';
import { useRuntimeStore } from '../runtime/runtimeStore';

function formatModelId(model: AiModelBinding['id']): string {
  switch (model) {
    case 'deterministic_policy':
      return 'Deterministic policy';
    case 'functiongemma_270m':
      return 'FunctionGemma 270M';
    case 'smollm2_1_7b':
      return 'SmolLM2 1.7B';
    case 'gemma4_e2b':
      return 'Gemma 4 E2B';
    case 'gemma4_e4b':
      return 'Gemma 4 E4B';
    case 'phi4_mini':
      return 'Phi-4 mini';
    case 'none':
      return 'None';
  }
}

function formatRuntime(runtime: AiModelBinding['runtime']): string {
  switch (runtime) {
    case 'deterministic':
      return 'Deterministic';
    case 'webllm':
      return 'WebLLM';
    case 'litert':
      return 'LiteRT';
  }
}

function formatLoadPolicy(policy: AiModelBinding['loadPolicy']): string {
  switch (policy) {
    case 'eager':
      return 'Eager';
    case 'lazy':
      return 'Lazy';
    case 'background':
      return 'Background';
    case 'disabled':
      return 'Disabled';
  }
}

function formatGiB(value: number): string {
  if (value <= 0) return '0 GiB';
  if (value < 1) return `${Math.round(value * 1024)} MiB`;
  return `${value.toFixed(value >= 10 ? 0 : 2)} GiB`;
}

function formatReasons(reasons: readonly string[]): string {
  if (reasons.length === 0) return 'No special constraints.';
  return reasons.map((reason) => reason.replaceAll('_', ' ')).join(' • ');
}

function ModelBindingRow({ label, binding }: { label: string; binding: AiModelBinding }) {
  return (
    <div
      style={{
        border: '1px solid var(--sep)',
        borderRadius: 10,
        padding: '9px 10px',
        display: 'grid',
        gap: 4,
        background: 'var(--surface, #fff)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: 'var(--label-3)' }}>
          {formatRuntime(binding.runtime)}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--label-1)' }}>
        {formatModelId(binding.id)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--label-3)' }}>
        {formatLoadPolicy(binding.loadPolicy)} • {formatGiB(binding.estimatedSizeGiB)}
        {binding.requiresExplicitConsent ? ' • requires consent' : ''}
      </div>
    </div>
  );
}

export function summarizeAiStackProfile(profile: AiStackProfile): string {
  const coordinator = formatModelId(profile.coordinator.id);
  if (profile.tier === 'baseline') {
    return 'Baseline deterministic profile. Router/coordinator model loading remains disabled.';
  }
  return `${profile.tier.replaceAll('_', ' ')} profile using ${coordinator} via ${formatRuntime(profile.runtime)}.`;
}

export default function AiStackProfileCard() {
  const capability = useRuntimeStore((state) => state.capability);
  const settingsMode = useRuntimeStore((state) => state.settingsMode);
  const allowLiteRt = useRuntimeStore((state) => state.allowLiteRt);
  const preferLiteRt = useRuntimeStore((state) => state.preferLiteRt);
  const userConsentedToLargeModels = useRuntimeStore((state) => state.userConsentedToLargeModels);
  const setAllowLiteRt = useRuntimeStore((state) => state.setAllowLiteRt);
  const setPreferLiteRt = useRuntimeStore((state) => state.setPreferLiteRt);
  const setUserConsentedToLargeModels = useRuntimeStore((state) => state.setUserConsentedToLargeModels);

  const profile = React.useMemo(() => {
    if (!capability) return null;
    return selectAiStackProfile(capability, {
      settingsMode,
      allowLiteRt,
      preferLiteRt,
      userConsentedToLargeModels,
    });
  }, [allowLiteRt, capability, preferLiteRt, settingsMode, userConsentedToLargeModels]);

  const upgradeCandidate = React.useMemo(() => {
    if (!capability || !profile) return null;
    return getBackgroundUpgradeCandidate(profile, capability, {
      settingsMode,
      allowLiteRt,
      preferLiteRt,
      userConsentedToLargeModels,
    });
  }, [allowLiteRt, capability, preferLiteRt, profile, settingsMode, userConsentedToLargeModels]);

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
          Router/coordinator stack
        </p>
        <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
          Read-only profile selection for future router/coordinator models. This does not load models or change execution.
        </p>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--label-2)', lineHeight: 1.35 }}>
          <input
            type="checkbox"
            checked={allowLiteRt}
            onChange={(event) => setAllowLiteRt(event.currentTarget.checked)}
            aria-label="Allow LiteRT runtime profile selection"
          />
          <span>
            Allow LiteRT profile selection on supported devices.
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: allowLiteRt ? 'var(--label-2)' : 'var(--label-4)', lineHeight: 1.35 }}>
          <input
            type="checkbox"
            checked={preferLiteRt}
            disabled={!allowLiteRt}
            onChange={(event) => setPreferLiteRt(event.currentTarget.checked)}
            aria-label="Prefer LiteRT profiles when available"
          />
          <span>
            Prefer LiteRT profiles when available.
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: allowLiteRt ? 'var(--label-2)' : 'var(--label-4)', lineHeight: 1.35 }}>
          <input
            type="checkbox"
            checked={userConsentedToLargeModels}
            disabled={!allowLiteRt}
            onChange={(event) => setUserConsentedToLargeModels(event.currentTarget.checked)}
            aria-label="Consent to large local model downloads"
          />
          <span>
            Permit large local coordinator downloads after explicit confirmation. Consent can be revoked at any time.
          </span>
        </label>
      </div>

      {!profile ? (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
          Capability probe has not finished yet. Stack profile selection is unavailable until the runtime is checked.
        </p>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            <ModelBindingRow label="Router" binding={profile.router} />
            <ModelBindingRow label="Coordinator" binding={profile.coordinator} />
            {profile.fallbackCoordinator.id !== 'none' && (
              <ModelBindingRow label="Fallback coordinator" binding={profile.fallbackCoordinator} />
            )}
          </div>

          <div style={{ fontSize: 11, color: 'var(--label-3)', lineHeight: 1.45 }}>
            <p style={{ margin: 0 }}>
              {summarizeAiStackProfile(profile)}
            </p>
            <p style={{ margin: '4px 0 0' }}>
              Selected by deterministic policy • capability tier {profile.diagnostics.capabilityTier} • WebGPU {profile.diagnostics.webgpu ? 'available' : 'unavailable'}
            </p>
            <p style={{ margin: '4px 0 0' }}>
              Reasons: {formatReasons(profile.diagnostics.reasons)}
            </p>
            {profile.diagnostics.degradeReasons.length > 0 && (
              <p style={{ margin: '4px 0 0', color: 'var(--orange, #a86413)' }}>
                Constraints: {formatReasons(profile.diagnostics.degradeReasons)}
              </p>
            )}
            {upgradeCandidate && (
              <p style={{ margin: '4px 0 0', color: 'var(--blue)' }}>
                Background upgrade candidate: {formatModelId(upgradeCandidate.coordinator.id)} → {upgradeCandidate.toTier.replaceAll('_', ' ')}
                {upgradeCandidate.requiresConsent ? ' (requires consent before download).' : '.'}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
