export type AbuseModelLabel =
  | 'toxic'
  | 'insult'
  | 'obscene'
  | 'identity_hate'
  | 'threat'
  | 'severe_toxic';

export interface AbuseModelScores {
  toxic: number;
  insult: number;
  obscene: number;
  identity_hate: number;
  threat: number;
  severe_toxic: number;
}

export interface AbuseModelResult {
  model: string;
  provider: string;
  label: AbuseModelLabel;
  score: number;
  scores: AbuseModelScores;
}
