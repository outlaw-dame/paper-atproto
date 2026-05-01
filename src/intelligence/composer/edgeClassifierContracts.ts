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

export interface ComposerEdgeClassifierResponse {
  provider: 'edge-heuristic';
  model: 'composer-edge-classifier-v1';
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
