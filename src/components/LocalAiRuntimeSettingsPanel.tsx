import React from 'react';
import AiStackProfileCard from './AiStackProfileCard';
import LocalAiRuntimeSection from './LocalAiRuntimeSection';

export default function LocalAiRuntimeSettingsPanel() {
  return React.createElement(
    'div',
    { style: { display: 'grid', gap: 12 } },
    React.createElement(AiStackProfileCard),
    React.createElement(LocalAiRuntimeSection),
  );
}
