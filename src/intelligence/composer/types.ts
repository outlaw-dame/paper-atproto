import type { AbuseModelResult } from '../../lib/abuseModel';
import type { SentimentResult } from '../../lib/sentiment';
import type { ComposerMLSignals } from './classifierContracts';

export type ComposerMode = 'post' | 'reply' | 'hosted_thread';
export type ComposerGuidanceLevel = 'ok' | 'positive' | 'caution' | 'warning' | 'alert';
export type ComposerGuidanceUiState = 'positive' | 'neutral' | 'caution' | 'warning' | 'alert';
export type ComposerGuidanceTool =
  | 'heuristic'
  | 'zero-shot-tone'
  | 'abuse-score'
  | 'sentiment-polarity'
  | 'emotion'
  | 'targeted-sentiment'
  | 'quality-score'
  | 'guidance-writer';

export interface ComposerDirectParent {
  uri?: string;
  text: string;
  authorHandle?: string;
}

export interface ComposerThreadContext {
  rootText?: string;
  ancestorTexts: string[];
  branchTexts: string[];
}

export interface ComposerReplyContext {
  siblingReplyTexts: string[];
  selectedCommentTexts: string[];
  totalReplyCount?: number;
  totalCommentCount?: number;
  totalThreadCount?: number;
}

export interface HostedThreadComposerMeta {
  prompt: string;
  description?: string;
  source?: string;
  topics: string[];
  audience?: string;
}

export interface ComposerContext {
  mode: ComposerMode;
  draftText: string;
  directParent?: ComposerDirectParent;
  threadContext?: ComposerThreadContext;
  replyContext?: ComposerReplyContext;
  hostedThread?: HostedThreadComposerMeta;
}

export interface ComposerGuidanceUi {
  state: ComposerGuidanceUiState;
  title: string;
  message: string;
  badges: string[];
  footnote: string;
  suggestion?: string;
  copySource?: 'template' | 'llm';
}

export interface ComposerGuidanceScores {
  positiveSignal: number;
  negativeSignal: number;
  supportiveness: number;
  constructiveness: number;
  clarifying: number;
  hostility: number;
  dismissiveness: number;
  escalation: number;
  sentimentPositive: number;
  sentimentNegative: number;
  anger: number;
  trust: number;
  optimism: number;
  targetedNegativity: number;
  toxicity: number;
}

export interface ComposerGuidanceResult {
  mode: ComposerMode;
  level: ComposerGuidanceLevel;
  heuristics: SentimentResult;
  ml: ComposerMLSignals;
  scores: ComposerGuidanceScores;
  toolsUsed: ComposerGuidanceTool[];
  abuseScore: AbuseModelResult | null;
  ui: ComposerGuidanceUi;
}
