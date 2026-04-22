export type CaptionButtonState = {
  label: string;
  disabled: boolean;
  showRemove: boolean;
};

/**
 * Derives the visual state of the "Generate/Regenerate Captions" button and
 * the "Remove Captions" button from the two pieces of async state that drive them.
 */
export function getCaptionButtonState(isGenerating: boolean, captionCount?: number): CaptionButtonState {
  const count = captionCount ?? 0;
  return {
    label: isGenerating
      ? 'Generating Captions…'
      : count > 0
        ? 'Regenerate Captions'
        : 'Generate Captions',
    disabled: isGenerating,
    showRemove: !isGenerating && count > 0,
  };
}
