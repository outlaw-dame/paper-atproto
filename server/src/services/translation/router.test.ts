import { describe, expect, it } from 'vitest';
import { chooseTranslationProvider } from './router.js';

describe('chooseTranslationProvider', () => {
  it('routes local private mode to bergamot for supported pairs', () => {
    const provider = chooseTranslationProvider({
      sourceLang: 'en',
      targetLang: 'es',
      mode: 'local_private',
      localOnlyMode: true,
      supportedByBergamot: true,
      hotPair: true,
    });

    expect(provider).toBe('bergamot');
  });

  it('routes hot pairs to marian for server default mode', () => {
    const provider = chooseTranslationProvider({
      sourceLang: 'en',
      targetLang: 'fr',
      mode: 'server_default',
      localOnlyMode: false,
      supportedByBergamot: true,
      hotPair: true,
    });

    expect(provider).toBe('marian');
  });

  it('routes hot pairs to marian for server optimized mode', () => {
    const provider = chooseTranslationProvider({
      sourceLang: 'de',
      targetLang: 'en',
      mode: 'server_optimized',
      localOnlyMode: false,
      supportedByBergamot: true,
      hotPair: true,
    });

    expect(provider).toBe('marian');
  });

  it('routes non-hot pairs to m2m100 when not local private', () => {
    const provider = chooseTranslationProvider({
      sourceLang: 'ar',
      targetLang: 'ru',
      mode: 'server_default',
      localOnlyMode: false,
      supportedByBergamot: false,
      hotPair: false,
    });

    expect(provider).toBe('m2m100');
  });

  it('falls back to m2m100 for local private with unsupported bergamot pair', () => {
    const provider = chooseTranslationProvider({
      sourceLang: 'ar',
      targetLang: 'en',
      mode: 'local_private',
      localOnlyMode: true,
      supportedByBergamot: false,
      hotPair: false,
    });

    expect(provider).toBe('m2m100');
  });
});
