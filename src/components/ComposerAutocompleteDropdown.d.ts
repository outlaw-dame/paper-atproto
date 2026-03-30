import type { AutocompleteCandidate } from '../hooks/useComposerAutocomplete.js';
interface Props {
    isOpen: boolean;
    candidates: AutocompleteCandidate[];
    selectedIndex: number;
    setSelectedIndex: (idx: number) => void;
    isLoading: boolean;
    triggerType: 'mention' | 'hashtag' | null;
    onSelect: (candidate: AutocompleteCandidate) => void;
}
export default function ComposerAutocompleteDropdown({ isOpen, candidates, selectedIndex, setSelectedIndex, isLoading, triggerType, onSelect, }: Props): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=ComposerAutocompleteDropdown.d.ts.map