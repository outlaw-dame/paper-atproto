export type ToneModelLabel = 'hostile' | 'supportive' | 'constructive' | 'positive' | 'neutral';
export interface ToneModelScores {
    hostile: number;
    supportive: number;
    constructive: number;
    positive: number;
    neutral: number;
}
export interface ToneModelResult {
    model: string;
    label: ToneModelLabel;
    scores: ToneModelScores;
}
//# sourceMappingURL=toneModel.d.ts.map