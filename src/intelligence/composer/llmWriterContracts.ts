import type {
  ComposerGuidanceScores,
  ComposerGuidanceUiState,
  ComposerMode,
} from './types';

export interface ComposerGuidanceWriteRequest {
  mode: ComposerMode;
  draftText: string;
  parentText?: string;
  uiState: Extract<ComposerGuidanceUiState, 'positive' | 'caution' | 'warning'>;
  scores: ComposerGuidanceScores;
  constructiveSignals: string[];
  supportiveSignals: string[];
  parentSignals: string[];
}

export interface ComposerGuidanceWriteResult {
  message: string;
  suggestion?: string;
  badges: string[];
}
