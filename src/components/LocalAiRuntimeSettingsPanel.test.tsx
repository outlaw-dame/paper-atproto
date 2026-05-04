// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

if (typeof document === 'undefined') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('Node', dom.window.Node);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
}

vi.mock('./AiStackProfileCard', () => ({
  default: () => <div data-testid="ai-stack-profile-card" />,
}));

vi.mock('./RouterCoordinatorDiagnosticsCard', () => ({
  default: () => <div data-testid="router-coordinator-diagnostics-card" />,
}));

vi.mock('./LocalAiRuntimeSection', () => ({
  default: () => <div data-testid="local-ai-runtime-section" />,
}));

const { render, screen } = await import('@testing-library/react');
const { default: LocalAiRuntimeSettingsPanel } = await import('./LocalAiRuntimeSettingsPanel');

describe('LocalAiRuntimeSettingsPanel', () => {
  it('composes stack profile diagnostics, router/coordinator diagnostics, and existing runtime controls in order', () => {
    render(<LocalAiRuntimeSettingsPanel />);

    const stackCard = screen.getByTestId('ai-stack-profile-card');
    const routerCoordinatorCard = screen.getByTestId('router-coordinator-diagnostics-card');
    const runtimeSection = screen.getByTestId('local-ai-runtime-section');

    expect(stackCard).toBeTruthy();
    expect(routerCoordinatorCard).toBeTruthy();
    expect(runtimeSection).toBeTruthy();
    expect(stackCard.compareDocumentPosition(routerCoordinatorCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(routerCoordinatorCard.compareDocumentPosition(runtimeSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
