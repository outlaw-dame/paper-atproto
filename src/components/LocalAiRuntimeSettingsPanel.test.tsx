// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LocalAiRuntimeSettingsPanel from './LocalAiRuntimeSettingsPanel';

vi.mock('./AiStackProfileCard', () => ({
  default: () => <div data-testid="ai-stack-profile-card" />,
}));

vi.mock('./LocalAiRuntimeSection', () => ({
  default: () => <div data-testid="local-ai-runtime-section" />,
}));

describe('LocalAiRuntimeSettingsPanel', () => {
  it('composes stack profile diagnostics before existing runtime controls', () => {
    render(<LocalAiRuntimeSettingsPanel />);

    const stackCard = screen.getByTestId('ai-stack-profile-card');
    const runtimeSection = screen.getByTestId('local-ai-runtime-section');

    expect(stackCard).toBeInTheDocument();
    expect(runtimeSection).toBeInTheDocument();
    expect(stackCard.compareDocumentPosition(runtimeSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
