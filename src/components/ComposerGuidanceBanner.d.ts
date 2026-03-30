import type { ComposerGuidanceResult } from '../intelligence/composer/types.js';
interface Props {
    guidance: ComposerGuidanceResult;
    parentSnippet?: string;
    onDismiss: () => void;
}
export default function ComposerGuidanceBanner({ guidance, parentSnippet, onDismiss, }: Props): import("react/jsx-runtime").JSX.Element | null;
export {};
//# sourceMappingURL=ComposerGuidanceBanner.d.ts.map