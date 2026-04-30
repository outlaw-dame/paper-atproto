import type { ComposerGuidanceResult, ComposerMode } from './types';

const MODEL_TOOLS = new Set([
  'zero-shot-tone',
  'abuse-score',
  'sentiment-polarity',
  'emotion',
  'targeted-sentiment',
  'quality-score',
]);

const WRITER_ELIGIBLE_STATES = new Set(['positive', 'caution', 'warning']);
const MIN_MODEL_TEXT_LENGTH = 12;
const MIN_WRITER_TEXT_LENGTH = 24;
const MIN_AUTOMATIC_BROWSER_ML_MEMORY_GIB = 8;

export interface ComposerBrowserMlGateOptions {
  automaticBrowserMlEnabled?: boolean;
  deviceMemoryGiB?: number | null;
  isMobile?: boolean;
}

export function getComposerModelDebounceMs(
  mode: ComposerMode,
  overrideMs?: number,
): number {
  if (typeof overrideMs === 'number') return overrideMs;
  if (mode === 'reply') return 500;
  if (mode === 'hosted_thread') return 450;
  return 550;
}

export function getComposerWriterDebounceMs(mode: ComposerMode): number {
  if (mode === 'reply') return 1400;
  if (mode === 'hosted_thread') return 1500;
  return 1650;
}

export function hasComposerModelCoverage(guidance: ComposerGuidanceResult): boolean {
  return guidance.toolsUsed.some((tool) => MODEL_TOOLS.has(tool));
}

export function hasComposerWriterCoverage(guidance: ComposerGuidanceResult): boolean {
  return guidance.toolsUsed.includes('guidance-writer');
}

export function isAutomaticComposerBrowserMlAllowed(
  options: ComposerBrowserMlGateOptions = {},
): boolean {
  const enabled = options.automaticBrowserMlEnabled ?? readBooleanEnv('VITE_ENABLE_AUTOMATIC_COMPOSER_BROWSER_ML');
  if (!enabled) return false;

  const isMobile = options.isMobile ?? isMobileRuntime();
  if (isMobile) return false;

  const deviceMemoryGiB = options.deviceMemoryGiB ?? getDeviceMemoryGiB();
  if (deviceMemoryGiB !== null && deviceMemoryGiB < MIN_AUTOMATIC_BROWSER_ML_MEMORY_GIB) {
    return false;
  }

  return true;
}

export function shouldRunComposerModelStageForDraft(
  mode: ComposerMode,
  draftText: string,
  guidance: ComposerGuidanceResult,
  browserMlGateOptions: ComposerBrowserMlGateOptions = {},
): boolean {
  if (!isAutomaticComposerBrowserMlAllowed(browserMlGateOptions)) return false;
  if (guidance.heuristics.hasMentalHealthCrisis) return false;
  if (guidance.level === 'alert') return false;

  return (
    draftText.trim().length >= MIN_MODEL_TEXT_LENGTH
    || mode === 'reply'
    || mode === 'hosted_thread'
    || guidance.level !== 'ok'
    || guidance.heuristics.parentSignals.length > 0
  );
}

export function shouldRunComposerWriterStage(
  mode: ComposerMode,
  draftText: string,
  guidance: ComposerGuidanceResult,
  dismissedAt: number | null,
): boolean {
  if (dismissedAt !== null) return false;
  if (guidance.heuristics.hasMentalHealthCrisis) return false;
  if (guidance.ui.state === 'alert' || guidance.ui.state === 'neutral') return false;
  if (!WRITER_ELIGIBLE_STATES.has(guidance.ui.state)) return false;
  if (draftText.trim().length < MIN_WRITER_TEXT_LENGTH) return false;
  if (mode === 'reply' && guidance.heuristics.parentSignals.length === 0 && guidance.scores.targetedNegativity < 0.2 && guidance.level === 'ok') {
    return false;
  }
  return true;
}

export function shouldReuseCachedComposerGuidance(
  mode: ComposerMode,
  draftText: string,
  guidance: ComposerGuidanceResult | undefined,
  dismissedAt: number | null,
): boolean {
  if (!guidance) return false;
  const hasModel = hasComposerModelCoverage(guidance);
  if (!hasModel && guidance.level !== 'alert') return false;

  const writerNeeded = shouldRunComposerWriterStage(mode, draftText, guidance, dismissedAt);
  if (!writerNeeded) return true;

  return hasComposerWriterCoverage(guidance);
}

function readBooleanEnv(key: string): boolean {
  const value = String(import.meta.env[key] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function getDeviceMemoryGiB(): number | null {
  if (typeof navigator === 'undefined') return null;
  const value = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? NaN);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isMobileRuntime(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent);
}
