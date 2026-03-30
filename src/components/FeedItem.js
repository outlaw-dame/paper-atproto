import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { motion } from 'framer-motion';
import { Card } from 'konsta/react';
import { Markdown } from './Markdown.js';
import { Gif } from './Gif.js';
import { LinkPreview } from './LinkPreview.js';
import { useProfileNavigation } from '../hooks/useProfileNavigation.js';
/**
 * An immersive feed item component inspired by Facebook Paper.
 * Uses Konsta UI for the base and Framer Motion for subtle animations.
 */
export const FeedItem = ({ post, onClick }) => {
    // Parse embed if it's a string (from DB)
    const embed = typeof post.embed === 'string' ? JSON.parse(post.embed) : post.embed;
    const navigateToProfile = useProfileNavigation();
    return (_jsx(motion.div, { whileTap: { scale: 0.98 }, onClick: onClick, className: "cursor-pointer", children: _jsx(Card, { margin: "m-4", className: "overflow-hidden rounded-xl shadow-lg border-none bg-white dark:bg-zinc-900", children: _jsxs("div", { className: "p-4", children: [_jsxs("div", { className: "flex items-center mb-3", children: [post.author.avatar ? (_jsx("img", { src: post.author.avatar, alt: post.author.handle, className: "w-10 h-10 rounded-full mr-3" })) : (_jsx("div", { className: "w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 mr-3 flex items-center justify-center", children: _jsx("span", { className: "text-zinc-500 text-sm font-bold", children: post.author.handle[0].toUpperCase() }) })), _jsxs("div", { children: [_jsx("button", { className: "interactive-link-button", onClick: (event) => { event.stopPropagation(); void navigateToProfile(post.author.handle); }, style: { justifyContent: 'flex-start' }, children: _jsx("div", { className: "font-bold text-sm dark:text-white", children: post.author.displayName || post.author.handle }) }), _jsx("button", { className: "interactive-link-button", onClick: (event) => { event.stopPropagation(); void navigateToProfile(post.author.handle); }, style: { justifyContent: 'flex-start' }, children: _jsxs("div", { className: "text-xs text-zinc-500", children: ["@", post.author.handle, " \u2022 ", new Date(post.createdAt).toLocaleDateString()] }) })] })] }), _jsx("div", { className: "text-base leading-relaxed dark:text-zinc-200", children: _jsx(Markdown, { content: post.content }) }), post.entities && post.entities.length > 0 && (_jsx("div", { className: "mt-3 flex flex-wrap gap-2", children: post.entities.map((entity, idx) => (_jsxs("div", { className: "px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-md text-xs font-medium flex items-center", title: entity.type, children: [_jsx("span", { className: "mr-1", children: "\uD83C\uDFF7\uFE0F" }), entity.text, entity.wikidata_id && (_jsx("a", { href: `https://www.wikidata.org/wiki/${entity.wikidata_id}`, target: "_blank", rel: "noopener noreferrer", className: "ml-1 opacity-50 hover:opacity-100", onClick: (e) => e.stopPropagation(), children: "(wiki)" }))] }, idx))) })), embed?.type === 'app.bsky.embed.external' && (embed.external.uri.includes('tenor.com') ? (_jsx(Gif, { url: embed.external.uri, title: embed.external.title, thumbnail: embed.external.thumb })) : (_jsx(LinkPreview, { url: embed.external.uri, title: embed.external.title, description: embed.external.description, image: embed.external.thumb })))] }) }) }));
};
//# sourceMappingURL=FeedItem.js.map