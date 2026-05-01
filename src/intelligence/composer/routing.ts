import {
  chooseIntelligenceLane,
  isBrowserExperimentalAllowed,
  type DeviceTier,
  type PrivacyMode,
} from '../intelligenceRoutingPolicy';
import { planEdgeExecution } from '../edge/edgeProviderPlanner';
import type { ComposerGuidanceResult, ComposerMode } from './types';

const MODEL_TOOLS = new Set([
  'edge-classifier',
  'zero-shot-tone',
  'abuse-score',
  'sentiment-polarity',
  'emotion',
  'targeted-sentiment',
  'quality-score',
]);

const WRITER_ELIGIBLE_STATES = new Set(['positive', 'caution', 'warning']);
const MIN_MODEL_TEXT_LENGTH = 12;
const MIN_EDGE_CLASSIFIER_TEXT_LENGTH = 12;
const MIN_WRITER_TEXT_LENGTH = 24;

export interface ComposerBrowserMlGateOptions {
  automaticBrowserMlEnabled?: boolean;
  deviceMemoryGiB?: number | null;
  isMobile?: boolean;
  deviceTier?: DeviceTier;
}

export interface ComposerEdgeClassifierRoutingOptions {
  privacyMode?: PrivacyMode;
  edgeAvailable?: boolean;
  cloudflareWorkersAiAvailable?: boolean;
  nodeHeuristicAvailable?: boolean;
}

export interface ComposerWriterRoutingOptions {
  privacyMode?: PrivacyMode;
  edgeAvailable?: boolean;
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
  return isBrowserExperimentalAllowed({
    browserExperimentalEnabled: options.automaticBrowserMlEnabled
      ?? readBooleanEnv(import.meta.env.VITE_ENABLE_AUTOMATIC_COMPOSER_BROWSER_ML),
    deviceMemoryGiB: options.deviceMemoryGiB ?? getDeviceMemoryGiB(),
    isMobile: options.isMobile ?? isMobileRuntime(),
    ...(options.deviceTier ? { deviceTier: options.deviceTier } : {}),
  });
}

export function shouldRunComposerModelStageForDraft(
  mode: ComposerMode,
  draftText: string,
  guidance: ComposerGuidanceResult,
  browserMlGateOptions: ComposerBrowserMlGateOptions = {},
): boolean {
  const decision = chooseIntelligenceLane({
    task: 'composer_refine',
    dataScope: 'private_draft',
    privacyMode: 'balanced',
    browserExperimentalEnabled: browserMlGateOptions.automaticBrowserMlEnabled
      ?? readBooleanEnv(import.meta.env.VITE_ENABLE_AUTOMATIC_COMPOSER_BROWSER_ML),
    deviceMemoryGiB: browserMlGateOptions.deviceMemoryGiB ?? getDeviceMemoryGiB(),
    isMobile: browserMlGateOptions.isMobile ?? isMobileRuntime(),
    ...(browserMlGateOptions.deviceTier ? { deviceTier: browserMlGateOptions.deviceTier } : {}),
    edgeAvailable: true,
  });

  if (decision.lane !== 'browser_experimental') return false;
  if (guidance.heuristics.hasMentalHealthCrisis) return false;
  if (guidance.level === 'alert') return false;

  return shouldRunRefinementForDraft(mode, draftText, guidance, MIN_MODEL_TEXT_LENGTH);
}

export function shouldRunComposerEdgeClassifierStageForDraft(
  mode: ComposerMode,
  draftText: string,
  guidance: ComposerGuidanceResult,
  routingOptions: ComposerEdgeClassifierRoutingOptions = {},
): boolean {
  const plan = planEdgeExecution({
    task: 'composer_refine',
    dataScope: 'private_draft',
    privacyMode: routingOptions.privacyMode ?? 'balanced',
    edgeAvailable: routingOptions.edgeAvailable,
  }, {
    availability: {
      cloudflareWorkersAi: routingOptions.cloudflareWorkersAiAvailable,
      nodeHeuristic: routingOptions.nodeHeuristicAvailable,
    },
  });

  if (!plan || plan.lane !== 'edge_classifier') return false;
  if (guidance.heuristics.hasMentalHealthCrisis) return false;
  if (guidance.level === 'alert') return false;

  return shouldRunRefinementForDraft(mode, draftText, guidance, MIN_EDGE_CLASSIFIER_TEXT_LENGTH);
}

export function shouldRunComposerWriterStage(
  mode: ComposerMode,
  draftText: string,
  guidance: ComposerGuidanceResult,
  dismissedAt: number | null,
  routingOptions: ComposerWriterRoutingOptions = {},
): boolean {
  const decision = chooseIntelligenceLane({
    task: 'composer_writer',
    dataScope: 'private_draft',
    privacyMode: routingOptions.privacyMode ?? 'balanced',
    edgeAvailable: routingOptions.edgeAvailable ?? true,
  });

  if (decision.lane !== 'server_writer') return false;
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

function shouldRunRefinementForDraft(
  mode: ComposerMode,
  draftText: string,
  guidance: ComposerGuidanceResult,
  minTextLength: number,
): boolean {
  return (
    draftText.trim().length >= minTextLength
    || mode === 'reply'
    || mode === 'hosted_thread'
    || guidance.level !== 'ok'
    || guidance.heuristics.parentSignals.length > 0
  );
}

function readBooleanEnv(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
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
