import { describe, expect, it } from 'vitest';
import { hasTranslatableLanguageSignal, heuristicDetectLanguage } from './detect';

describe('i18n language detection signal gating', () => {
  it('treats emoji-only text as non-translatable content', () => {
    expect(hasTranslatableLanguageSignal('😂🔥🙏')).toBe(false);
    expect(heuristicDetectLanguage('😂🔥🙏').language).toBe('und');
  });

  it('accepts multilingual letter scripts as translatable content', () => {
    expect(hasTranslatableLanguageSignal('مرحبا بالعالم')).toBe(true);
    expect(hasTranslatableLanguageSignal('こんにちは世界')).toBe(true);
    expect(hasTranslatableLanguageSignal('hola')).toBe(true);
  });

  it('returns und for low-signal Latin text instead of forcing English', () => {
    const detected = heuristicDetectLanguage('lorem ipsum dolor sit amet');
    expect(detected.language).toBe('und');
  });

  it('still detects clear non-English Latin text', () => {
    const detected = heuristicDetectLanguage('¿cómo estás? gracias por todo');
    expect(detected.language).toBe('es');
  });
});
