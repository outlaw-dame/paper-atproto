import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import Twemoji from 'react-twemoji';
/**
 * A reusable component that renders emojis using Twemoji for cross-platform consistency.
 * It wraps the content and automatically replaces native emojis with Twemoji images.
 */
export const Emoji = ({ children, className }) => {
    const TwemojiComponent = Twemoji.default
        ?? Twemoji;
    if (typeof TwemojiComponent !== 'function') {
        return _jsx(_Fragment, { children: children });
    }
    return (_jsx(TwemojiComponent, { tag: "span", options: { className: `twemoji inline-block w-[1em] h-[1em] align-[-0.1em] mx-[0.05em] ${className || ''}` }, children: children }));
};
//# sourceMappingURL=Emoji.js.map