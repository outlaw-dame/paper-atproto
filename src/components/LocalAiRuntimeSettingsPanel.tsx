import React from 'react';
import AiStackProfileCard from './AiStackProfileCard';
import LocalAiRuntimeSection from './LocalAiRuntimeSection';

export default function LocalAiRuntimeSettingsPanel() {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <AiStackProfileCard />
      <LocalAiRuntimeSection />
    </div>
  );
}
