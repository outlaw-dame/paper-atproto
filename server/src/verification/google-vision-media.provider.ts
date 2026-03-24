import { ImageAnnotatorClient } from '@google-cloud/vision';
import type { MediaVerificationResult } from './types.js';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class GoogleVisionMediaProvider {
  private readonly client: ImageAnnotatorClient;

  constructor() {
    this.client = new ImageAnnotatorClient();
  }

  async verifyImage(imageUrl: string): Promise<MediaVerificationResult> {
    const [result] = await this.client.webDetection(imageUrl);
    const web = result.webDetection;

    const bestGuessLabels = (web?.bestGuessLabels ?? []).map((x) => x.label ?? '').filter(Boolean);
    const webEntities = (web?.webEntities ?? []).map((e) => ({
      ...(e.description !== undefined && e.description !== null ? { description: e.description } : {}),
      ...(e.score !== undefined && e.score !== null ? { score: e.score } : {}),
    }));
    const pagesWithMatchingImages = (web?.pagesWithMatchingImages ?? []).map((p) => p.url ?? '').filter(Boolean);
    const fullMatchingImages = (web?.fullMatchingImages ?? []).map((i) => i.url ?? '').filter(Boolean);

    const mediaContextConfidence = clamp01(fullMatchingImages.length * 0.25 + pagesWithMatchingImages.length * 0.1);
    const mismatchRisk = bestGuessLabels.length === 0 && pagesWithMatchingImages.length === 0 && fullMatchingImages.length === 0 ? 0.65 : 0.15;

    return { bestGuessLabels, webEntities, pagesWithMatchingImages, fullMatchingImages, mediaContextConfidence, mismatchRisk };
  }
}
