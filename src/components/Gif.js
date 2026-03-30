import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Card } from 'konsta/react';
/**
 * A component to render GIFs in the feed and post details.
 * It supports lazy loading and provides a consistent look and feel.
 */
export const Gif = ({ url, title, thumbnail, className }) => {
    return (_jsxs("div", { className: `gif-container relative overflow-hidden rounded-xl my-2 bg-zinc-100 dark:bg-zinc-900 ${className || ''}`, children: [_jsx("img", { src: url, alt: title || 'GIF', className: "w-full h-auto block object-cover max-h-[400px]", loading: "lazy", onError: (e) => {
                    if (thumbnail) {
                        e.target.src = thumbnail;
                    }
                } }), title && (_jsx("div", { className: "absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent text-white text-xs font-medium truncate", children: title }))] }));
};
//# sourceMappingURL=Gif.js.map