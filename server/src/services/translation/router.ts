import type { TranslationMode, TranslationProvider } from './types.js';

type ProviderRouteInput = {
  sourceLang: string;
  targetLang: string;
  mode: TranslationMode;
  localOnlyMode: boolean;
  supportedByBergamot: boolean;
  hotPair: boolean;
};

export function chooseTranslationProvider(input: ProviderRouteInput): TranslationProvider {
  if (input.localOnlyMode && input.supportedByBergamot) {
    return 'bergamot';
  }

  if (input.hotPair && input.mode !== 'local_private') {
    return 'marian';
  }

  return 'm2m100';
}
