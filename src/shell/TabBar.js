import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ─── TabBar ────────────────────────────────────────────────────────────────
// Persistent bottom navigation bar. Reads active tab from uiStore and writes
// back via setTab / openCompose. Renders the compose FAB in the centre slot.
import React from 'react';
import { useUiStore } from '../store/uiStore.js';
import { usePlatform, getIconBtnTokens } from '../hooks/usePlatform.js';
const TABS = [
    {
        id: 'home', label: 'Home',
        icon: (a) => (_jsxs("svg", { width: "24", height: "24", viewBox: "0 0 24 24", fill: a ? 'var(--blue)' : 'none', stroke: a ? 'var(--blue)' : 'var(--label-2)', strokeWidth: a ? 2.5 : 1.75, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" }), _jsx("path", { d: "M9 21V12h6v9" })] })),
    },
    {
        id: 'explore', label: 'Explore',
        icon: (a) => (_jsxs("svg", { width: "24", height: "24", viewBox: "0 0 24 24", fill: "none", stroke: a ? 'var(--blue)' : 'var(--label-2)', strokeWidth: a ? 2.5 : 1.75, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("circle", { cx: "11", cy: "11", r: "8" }), _jsx("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" })] })),
    },
    {
        id: 'activity', label: 'Activity',
        icon: (a) => (_jsxs("svg", { width: "24", height: "24", viewBox: "0 0 24 24", fill: "none", stroke: a ? 'var(--blue)' : 'var(--label-2)', strokeWidth: a ? 2.5 : 1.75, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" }), _jsx("path", { d: "M13.73 21a2 2 0 01-3.46 0" })] })),
    },
    {
        id: 'profile', label: 'Profile',
        icon: (a) => (_jsxs("svg", { width: "24", height: "24", viewBox: "0 0 24 24", fill: a ? 'var(--blue)' : 'none', stroke: a ? 'var(--blue)' : 'var(--label-2)', strokeWidth: a ? 2.2 : 1.75, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" }), _jsx("circle", { cx: "12", cy: "7", r: "4" })] })),
    },
];
const tabBarStyle = {
    flexShrink: 0,
    display: 'flex', flexDirection: 'row', alignItems: 'stretch',
    background: 'var(--chrome-bg)',
    backdropFilter: 'blur(20px) saturate(180%)',
    WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    paddingBottom: 'var(--safe-bottom)',
};
export default function TabBar({ hidden = false }) {
    const { activeTab, unreadCount, setTab } = useUiStore();
    const platform = usePlatform();
    const iconTokens = getIconBtnTokens(platform);
    const tabBtnStyle = {
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        paddingTop: platform.prefersCoarsePointer ? 10 : 8,
        paddingBottom: platform.prefersCoarsePointer ? 8 : 6,
        gap: 3,
        minHeight: platform.prefersCoarsePointer ? 56 : 50,
        cursor: 'pointer',
        border: 'none', background: 'none',
        WebkitTapHighlightColor: 'transparent',
    };
    return (_jsx("nav", { style: {
            ...tabBarStyle,
            maxHeight: hidden ? 0 : 120,
            opacity: hidden ? 0 : 1,
            transform: hidden ? 'translateY(12px)' : 'translateY(0)',
            pointerEvents: hidden ? 'none' : 'auto',
            overflow: 'hidden',
            transition: 'max-height 0.18s ease, opacity 0.16s ease, transform 0.16s ease',
        }, role: "tablist", "aria-label": "Main navigation", "aria-hidden": hidden, children: TABS.map(({ id, label, icon }) => {
            const active = id === activeTab;
            return (_jsxs("button", { style: tabBtnStyle, onClick: () => setTab(id), role: "tab", "aria-selected": active, "aria-label": label, children: [_jsxs("div", { style: { position: 'relative' }, children: [_jsx("div", { style: {
                                    width: iconTokens.size,
                                    height: iconTokens.size,
                                    borderRadius: iconTokens.borderRadius,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }, children: icon(active) }), id === 'activity' && unreadCount > 0 && (_jsx("span", { style: {
                                    position: 'absolute', top: -3, right: -6,
                                    minWidth: 16, height: 16, borderRadius: 8,
                                    background: 'var(--red)', color: '#fff',
                                    fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 700, letterSpacing: 'var(--type-meta-sm-track)', fontVariantNumeric: 'tabular-nums',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: '0 4px',
                                }, children: unreadCount > 99 ? '99+' : unreadCount }))] }), _jsx("span", { style: { fontFamily: 'var(--font-ui)', fontSize: 'var(--type-meta-sm-size)', lineHeight: 'var(--type-meta-sm-line)', fontWeight: 600, letterSpacing: 'var(--type-meta-sm-track)', color: active ? 'var(--blue)' : 'var(--label-2)' }, children: label })] }, id));
        }) }));
}
//# sourceMappingURL=TabBar.js.map