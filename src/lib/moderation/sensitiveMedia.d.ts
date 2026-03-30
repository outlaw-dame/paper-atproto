import type { MockPost } from '../../data/mockData.js';
export interface SensitiveMediaAssessment {
    isSensitive: boolean;
    reasons: string[];
    source: 'label' | 'post';
}
export declare function detectSensitiveMedia(post: MockPost): SensitiveMediaAssessment;
export declare function mapRawLabelValues(raw: unknown): string[];
//# sourceMappingURL=sensitiveMedia.d.ts.map