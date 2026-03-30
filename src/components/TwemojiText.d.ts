import React from 'react';
import type { ResolvedFacet } from '../lib/resolver/atproto.js';
type OnMention = (handle: string) => void;
type OnHashtag = (tag: string) => void;
type OnCashtag = (cashtag: string) => void;
interface Props {
    text: string;
    /** ATProto resolved facets. When provided, used instead of regex for byte-accurate rendering. */
    facets?: ResolvedFacet[];
    className?: string;
    style?: React.CSSProperties;
    onMention?: OnMention;
    onHashtag?: OnHashtag;
    onCashtag?: OnCashtag;
}
export default function TwemojiText({ text, facets, className, style, onMention, onHashtag, onCashtag }: Props): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=TwemojiText.d.ts.map