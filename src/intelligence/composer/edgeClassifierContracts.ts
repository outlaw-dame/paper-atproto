import type { AbuseModelResult } from '../../lib/abuseModel';
import type { ComposerMLSignals } from './classifierContracts';
import type { ComposerMode } from './types';

export interface ComposerEdgeClassifierRequest {
  mode: ComposerMode;
  draftText: string;
  parentText?: string;
  targetText?: string;
  contextSignals?: string[];
}

export type ComposerEdgeClassifierProvider = 'edge-heuristic' | 'cloudflare-workers-ai';

export interface ComposerEdgeClassifierResponse {
  provider: ComposerEdgeClassifierProvider;
  model: 'composer-edge-classifier-v1' | '@cf/huggingface/distilbert-sst-2-int8';
  confidence: number;
  toolsUsed: Array<
    | 'edge-classifier'
    | 'sentiment-polarity'
    | 'emotion'
    | 'targeted-sentiment'
    | 'quality-score'
    | 'abuse-score'
  >;
  ml: ComposerMLSignals;
  abuseScore: AbuseModelResult | null;
}
