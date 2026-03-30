import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ─── ComposerAutocompleteDropdown ─────────────────────────────────────────
// Floating suggestion panel that appears below the compose textarea when
// the user types an @mention or #hashtag trigger.
//
// Design rules:
//  • Appears as a surface card, no portal needed — positioned relative to
//    the textarea container via `position: absolute`.
//  • Max 6 items, scrollable if fewer than the cap.
//  • Fully keyboard-navigable (handled in useComposerAutocomplete).
//  • Mouse hover syncs the selected index.
//  • Screen-reader accessible: role="listbox" + aria-selected per option.
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// ─── Spinner ────────────────────────────────────────────────────────────────
function Spinner() {
    return (_jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "var(--blue)", strokeWidth: 2.5, strokeLinecap: "round", "aria-hidden": "true", children: _jsx("path", { d: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", children: _jsx("animateTransform", { attributeName: "transform", type: "rotate", from: "0 12 12", to: "360 12 12", dur: "0.75s", repeatCount: "indefinite" }) }) }));
}
// ─── Mention row ────────────────────────────────────────────────────────────
function MentionRow({ candidate, selected, onPointerEnter, onSelect, }) {
    const initials = (candidate.displayName?.[0] ?? candidate.handle[0] ?? '?').toUpperCase();
    return (_jsxs("button", { role: "option", "aria-selected": selected, onPointerEnter: onPointerEnter, onPointerDown: (e) => {
            // Prevent textarea blur before we can commit the selection.
            e.preventDefault();
            onSelect();
        }, style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '8px 12px',
            background: selected ? 'rgba(10,132,255,0.10)' : 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.1s ease',
            WebkitTapHighlightColor: 'transparent',
        }, children: [_jsx("div", { style: {
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, var(--blue) 0%, var(--indigo) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 700,
                    flexShrink: 0,
                    overflow: 'hidden',
                }, children: candidate.avatar ? (_jsx("img", { src: candidate.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' }, loading: "lazy", decoding: "async" })) : (initials) }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [candidate.displayName && (_jsx("div", { style: {
                            fontSize: 14,
                            fontWeight: 600,
                            color: 'var(--label-1)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            lineHeight: 1.3,
                        }, children: candidate.displayName })), _jsxs("div", { style: {
                            fontSize: 13,
                            color: 'var(--label-3)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            lineHeight: 1.3,
                        }, children: ["@", candidate.handle] })] })] }));
}
// ─── Hashtag row ─────────────────────────────────────────────────────────────
function HashtagRow({ candidate, selected, onPointerEnter, onSelect, }) {
    return (_jsxs("button", { role: "option", "aria-selected": selected, onPointerEnter: onPointerEnter, onPointerDown: (e) => {
            e.preventDefault();
            onSelect();
        }, style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '9px 12px',
            background: selected ? 'rgba(10,132,255,0.10)' : 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            transition: 'background 0.1s ease',
            WebkitTapHighlightColor: 'transparent',
        }, children: [_jsx("div", { style: {
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: 'rgba(10,132,255,0.10)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }, children: _jsx("span", { style: { fontSize: 16, fontWeight: 700, color: 'var(--blue)', lineHeight: 1 }, children: "#" }) }), _jsx("div", { style: { flex: 1, minWidth: 0 }, children: _jsx("span", { style: {
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--label-1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }, children: candidate.tag }) }), candidate.isTrending && (_jsx("span", { style: {
                    fontSize: 10,
                    fontWeight: 800,
                    color: 'var(--red)',
                    background: 'rgba(255,59,48,0.10)',
                    borderRadius: 6,
                    padding: '2px 6px',
                    letterSpacing: 0.3,
                    flexShrink: 0,
                }, children: "TRENDING" }))] }));
}
export default function ComposerAutocompleteDropdown({ isOpen, candidates, selectedIndex, setSelectedIndex, isLoading, triggerType, onSelect, }) {
    return (_jsx(AnimatePresence, { children: isOpen && (_jsxs(motion.div, { initial: { opacity: 0, y: -6, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -6, scale: 0.97 }, transition: { duration: 0.14, ease: [0.25, 0.1, 0.25, 1] }, role: "listbox", "aria-label": triggerType === 'mention' ? 'Mention suggestions' : 'Hashtag suggestions', style: {
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 300,
                marginTop: 4,
                background: 'var(--surface)',
                border: '0.5px solid var(--sep)',
                borderRadius: 14,
                boxShadow: '0 6px 28px rgba(0,0,0,0.18)',
                overflow: 'hidden',
            }, children: [_jsxs("div", { style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderBottom: '0.5px solid var(--sep)',
                        background: 'var(--fill-1)',
                    }, children: [_jsx("span", { style: {
                                fontSize: 11,
                                fontWeight: 800,
                                color: 'var(--blue)',
                                textTransform: 'uppercase',
                                letterSpacing: 0.5,
                            }, children: triggerType === 'mention' ? 'People' : 'Hashtags' }), isLoading && (_jsx("span", { style: { marginLeft: 4 }, children: _jsx(Spinner, {}) })), _jsx("span", { style: { fontSize: 10, color: 'var(--label-4)', marginLeft: 'auto' }, children: "\u2191\u2193 navigate \u00B7 \u21B5 select \u00B7 Esc dismiss" })] }), _jsxs("div", { style: { maxHeight: 240, overflowY: 'auto' }, children: [candidates.map((candidate, idx) => candidate.type === 'mention' ? (_jsx(MentionRow, { candidate: candidate, selected: idx === selectedIndex, onPointerEnter: () => setSelectedIndex(idx), onSelect: () => onSelect(candidate) }, candidate.did)) : (_jsx(HashtagRow, { candidate: candidate, selected: idx === selectedIndex, onPointerEnter: () => setSelectedIndex(idx), onSelect: () => onSelect(candidate) }, candidate.tag))), !isLoading && candidates.length === 0 && (_jsx("div", { style: {
                                padding: '12px',
                                fontSize: 13,
                                color: 'var(--label-4)',
                                textAlign: 'center',
                            }, children: "No results" }))] })] }, "ac-dropdown")) }));
}
//# sourceMappingURL=ComposerAutocompleteDropdown.js.map