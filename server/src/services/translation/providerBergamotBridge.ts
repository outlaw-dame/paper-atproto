type BergamotTranslateInput = {
  text: string;
  sourceLang: string;
  targetLang: string;
};

// Server bridge placeholder. In true local-private mode, client should translate locally.
export class BergamotBridgeProvider {
  readonly modelVersion = 'bergamot-bridge-v1';

  async translate(input: BergamotTranslateInput): Promise<string> {
    if (input.sourceLang === input.targetLang) return input.text;
    return `[local ${input.sourceLang}->${input.targetLang}] ${input.text}`;
  }
}
