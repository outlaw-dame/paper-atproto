import React from 'react';
import SensitiveMediaSection from './SensitiveMediaSection.js';
import ContentFilterSettingsSection from './ContentFilterSettingsSection.js';
import ModerationSection from './ModerationSection.js';

export default function ModerationSettingsPage() {
  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35, marginBottom: 10 }}>
        Controls for sensitive media, keyword filters, and account-level moderation.
      </p>

      <SensitiveMediaSection />

      <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

      <ContentFilterSettingsSection />

      <hr style={{ border: 0, borderTop: '1px solid var(--sep)', margin: '14px 0 10px' }} />

      <ModerationSection />
    </div>
  );
}
