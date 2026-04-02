import React from 'react';
import SensitiveMediaSection from './SensitiveMediaSection';
import ContentFilterSettingsSection from './ContentFilterSettingsSection';
import InterpolatorSettingsSection from './InterpolatorSettingsSection';
import LazyModuleBoundary from './LazyModuleBoundary';
import ModerationSection from './ModerationSection';
import ModerationPolicySummaryCard from './ModerationPolicySummaryCard';
import { SettingsPageFallback } from './TranslationSettingsSheetFallback';
import { lazyWithRetry } from '../lib/lazyWithRetry';

const LocalAiRuntimeSection = lazyWithRetry(
  () => import('./LocalAiRuntimeSection'),
  'LocalAiRuntimeSection',
);

export default function ModerationSettingsPage() {
  return (
    <div>
      <div
        style={{
          border: '1px solid var(--sep)',
          borderRadius: 12,
          padding: '10px 12px',
          background: 'var(--fill-1)',
          marginBottom: 12,
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-1)', marginBottom: 4 }}>
          Moderation control center
        </p>
        <p style={{ fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35 }}>
          Centralized moderation settings: account-level controls first, then
          content filters and sensitive-media controls.
        </p>
      </div>

      <ModerationPolicySummaryCard />

      <InterpolatorSettingsSection />

      <LazyModuleBoundary
        resetKey="local-ai-runtime"
        fallback={<SettingsPageFallback label="Local AI runtime controls failed to load." />}
      >
        <React.Suspense fallback={<SettingsPageFallback label="Loading local AI runtime controls…" />}>
          <LocalAiRuntimeSection />
        </React.Suspense>
      </LazyModuleBoundary>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: '8px 10px', background: 'var(--fill-1)' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-2)' }}>Moderation tools</p>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
            Mutes and blocks are account-level controls and should be treated as canonical across feed, conversations, and notifications.
          </p>
        </div>
        <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: '8px 10px', background: 'var(--fill-1)' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-2)' }}>Content filters</p>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
            Keyword and semantic rules are local-first controls with optional account-level sync.
          </p>
        </div>
        <div style={{ border: '1px solid var(--sep)', borderRadius: 10, padding: '8px 10px', background: 'var(--fill-1)' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--label-2)' }}>Surface coverage</p>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--label-3)', lineHeight: 1.35 }}>
            Explore context also applies to Search Story screens, so a single rule can cover both discovery surfaces.
          </p>
        </div>
      </div>

      <ModerationSection />

      <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

      <SensitiveMediaSection />

      <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

      <ContentFilterSettingsSection />
    </div>
  );
}
