// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LocalAiRuntimeSettingsPanel from './LocalAiRuntimeSettingsPanel';

vi.mock('./AiStackProfileCard', () => ({
  default: () => <div data-testid="ai-stack-profile-card" />,
}));

vi.mock('./RouterCoordinatorDiagnosticsCard', () => ({
  default: () => <div data-testid="router-coordinator-diagnostics-card" />,
}));

vi.mock('./LocalAiRuntimeSection', () => ({
  default: () => <div data-testid="local-ai-runtime-section" />,
}));

describe('LocalAiRuntimeSettingsPanel', () => {
  it('composes stack profile diagnostics, router/coordinator diagnostics, and existing runtime controls in order', () => {
    render(<LocalAiRuntimeSettingsPanel />);

    const stackCard = screen.getByTestId('ai-stack-profile-card');
    const routerCoordinatorCard = screen.getByTestId('router-coordinator-diagnostics-card');
    const runtimeSection = screen.getByTestId('local-ai-runtime-section');

    expect(stackCard).toBeInTheDocument();
    expect(routerCoordinatorCard).toBeInTheDocument();
    expect(runtimeSection).toBeInTheDocument();
    expect(stackCard.compareDocumentPosition(routerCoordinatorCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(routerCoordinatorCard.compareDocumentPosition(runtimeSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
