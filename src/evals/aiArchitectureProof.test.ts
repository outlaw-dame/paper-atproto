import { describe, expect, it } from 'vitest';
import {
  assertAiArchitectureProofReport,
  buildAiArchitectureProofReport,
} from './aiArchitectureProof';

describe('AI architecture proof report', () => {
  it('proves architecture invariants with machine-readable evidence', async () => {
    const report = await buildAiArchitectureProofReport({
      generatedAt: '2026-04-23T00:00:00.000Z',
    });

    assertAiArchitectureProofReport(report);

    expect(report.summary).toEqual({
      total: report.proofs.length,
      passed: report.proofs.length,
      failed: 0,
    });
    expect(report.proofs.length).toBeGreaterThanOrEqual(10);
    expect(report.proofs.every((proof) => Object.keys(proof.evidence).length > 0)).toBe(true);
    expect(report.proofs.map((proof) => proof.id)).toContain('interpretive.fact_check_monotonicity');
    expect(report.proofs.map((proof) => proof.id)).toContain('verification.boundary.safe_browsing_is_not_fact_check');
    expect(report.proofs.map((proof) => proof.id)).toContain('ranking.ethical_engagement_is_bounded_by_interpretive_quality');
    expect(report.proofs.map((proof) => proof.id)).toContain('ranking.local_personalization_is_local_bounded_and_non_identifying');
    expect(report.proofs.map((proof) => proof.id)).toContain('privacy.local_user_data_is_browser_local_only');
  });
});
