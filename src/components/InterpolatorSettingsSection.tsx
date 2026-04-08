import React from 'react';
import { useSessionStore } from '../store/sessionStore';
import { useInterpolatorSettingsStore } from '../store/interpolatorSettingsStore';
import { getPremiumAiEntitlements } from '../intelligence/modelClient';
import type { PremiumAiEntitlements, PremiumAiProviderPreference } from '../intelligence/premiumContracts';

const PREMIUM_PROVIDER_OPTIONS: Array<{
  value: PremiumAiProviderPreference;
  label: string;
  description: string;
}> = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'Use the server default, with safe fallback if your preferred remote provider is unavailable.',
  },
  {
    value: 'gemini',
    label: 'Gemini 3',
    description: 'Use Gemini 3 for premium deep thread synthesis when it is available.',
  },
  {
    value: 'openai',
    label: 'ChatGPT',
    description: 'Use the ChatGPT API for premium deep thread synthesis when it is available.',
  },
];

function labelForPremiumProvider(value: PremiumAiProviderPreference | undefined): string {
  if (value === 'gemini') return 'Gemini 3';
  if (value === 'openai') return 'ChatGPT';
  return 'Auto';
}

export default function InterpolatorSettingsSection() {
  const enabled = useInterpolatorSettingsStore((state) => state.enabled);
  const premiumProviderPreference = useInterpolatorSettingsStore((state) => state.premiumProviderPreference);
  const setEnabled = useInterpolatorSettingsStore((state) => state.setEnabled);
  const setPremiumProviderPreference = useInterpolatorSettingsStore((state) => state.setPremiumProviderPreference);
  const sessionDid = useSessionStore((state) => state.session?.did ?? null);
  const [premiumEntitlements, setPremiumEntitlements] = React.useState<PremiumAiEntitlements | null>(null);
  const [premiumEntitlementsLoading, setPremiumEntitlementsLoading] = React.useState(false);
  const [premiumEntitlementsError, setPremiumEntitlementsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!sessionDid) {
      setPremiumEntitlements(null);
      setPremiumEntitlementsError(null);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setPremiumEntitlementsLoading(true);
    setPremiumEntitlementsError(null);

    void getPremiumAiEntitlements(sessionDid, controller.signal)
      .then((value) => {
        if (!active) return;
        setPremiumEntitlements(value);
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        setPremiumEntitlementsError(error instanceof Error ? error.message : 'Failed to load premium AI availability.');
      })
      .finally(() => {
        if (!active) return;
        setPremiumEntitlementsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [sessionDid, premiumProviderPreference]);

  const availableProviders = premiumEntitlements?.availableProviders ?? [];
  const activePremiumProvider = premiumEntitlements?.provider;
  const preferredProviderUnavailable = premiumProviderPreference !== 'auto'
    && availableProviders.length > 0
    && !availableProviders.includes(premiumProviderPreference);

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

      <div style={{ marginTop: 10, borderTop: '1px solid var(--sep)', paddingTop: 10 }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-2)' }}>
          Premium Deep Analysis Provider
        </p>
        <p style={{ margin: '3px 0 8px', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.4 }}>
          Choose which remote model handles premium deep thread synthesis. The base Interpolator writer still stays on the fast local-first path.
        </p>

        <div style={{ display: 'grid', gap: 8 }}>
          {PREMIUM_PROVIDER_OPTIONS.map((option) => {
            const checked = premiumProviderPreference === option.value;
            return (
              <label
                key={option.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '8px 9px',
                  borderRadius: 10,
                  border: `1px solid ${checked ? 'var(--blue)' : 'var(--sep)'}`,
                  background: checked ? 'color-mix(in srgb, var(--blue) 10%, var(--fill-1) 90%)' : 'var(--fill-1)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="premium-ai-provider"
                  value={option.value}
                  checked={checked}
                  onChange={() => setPremiumProviderPreference(option.value)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--label-1)' }}>
                    {option.label}
                  </span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
            Preferred provider: {labelForPremiumProvider(premiumProviderPreference)}.
          </p>
          {sessionDid ? (
            premiumEntitlementsLoading ? (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)' }}>
                Checking premium AI availability…
              </p>
            ) : premiumEntitlementsError ? (
              <p style={{ margin: 0, fontSize: 11, color: '#b42318', lineHeight: 1.35 }}>
                {premiumEntitlementsError}
              </p>
            ) : availableProviders.length > 0 ? (
              <>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
                  Available now: {availableProviders.map((provider) => labelForPremiumProvider(provider)).join(', ')}.
                </p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
                  Active premium provider: {labelForPremiumProvider(activePremiumProvider)}.
                </p>
                {preferredProviderUnavailable && (
                  <p style={{ margin: 0, fontSize: 11, color: '#9a6700', lineHeight: 1.35 }}>
                    Your preferred provider is unavailable right now, so premium deep analysis will fall back automatically.
                  </p>
                )}
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
                No remote premium provider is currently available for this account.
              </p>
            )
          ) : (
            <p style={{ margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
              Sign in to check whether Gemini 3 or ChatGPT is currently available for premium deep analysis.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
