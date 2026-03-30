import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Card } from 'konsta/react';
import { getSafeExternalHostname, openExternalUrl, sanitizeExternalUrl } from '../lib/safety/externalUrl.js';
export const LinkPreview = ({ url, title, description, image, siteName, }) => {
    const safeUrl = sanitizeExternalUrl(url);
    const hostname = getSafeExternalHostname(url);
    if (!safeUrl || !hostname) {
        return null;
    }
    return (_jsxs(Card, { margin: "m-0", className: "overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors", onClick: () => { openExternalUrl(safeUrl); }, children: [image && (_jsx("div", { className: "aspect-video w-full overflow-hidden border-b border-zinc-200 dark:border-zinc-800", children: _jsx("img", { src: image, alt: title || 'Link preview', className: "w-full h-full object-cover", loading: "lazy", referrerPolicy: "no-referrer", decoding: "async" }) })), _jsxs("div", { className: "p-3", children: [_jsx("div", { className: "text-xs text-zinc-500 uppercase tracking-wider mb-1 truncate", children: siteName || hostname }), title && (_jsx("div", { className: "font-bold text-sm dark:text-white line-clamp-2 mb-1", children: title })), description && (_jsx("div", { className: "text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2", children: description }))] })] }));
};
//# sourceMappingURL=LinkPreview.js.map