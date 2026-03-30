import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { motion } from 'framer-motion';
export default function ComposerGuidanceBanner({ guidance, parentSnippet, onDismiss, }) {
    const result = guidance.heuristics;
    if (guidance.level === 'ok' && result.parentSignals.length === 0)
        return null;
    const isReply = guidance.mode === 'reply' && (result.parentSignals.length > 0 || !!parentSnippet);
    const state = guidance.ui.state;
    const accentColor = state === 'alert'
        ? 'var(--red)'
        : state === 'positive'
            ? 'var(--green)'
            : state === 'neutral'
                ? 'var(--blue)'
                : state === 'warning'
                    ? 'var(--red)'
                    : 'var(--orange)';
    const bgColor = state === 'alert'
        ? 'rgba(255,59,48,0.09)'
        : state === 'positive'
            ? 'rgba(52,199,89,0.1)'
            : state === 'neutral'
                ? 'rgba(10,132,255,0.07)'
                : state === 'warning'
                    ? 'rgba(255,59,48,0.09)'
                    : 'rgba(255,149,0,0.09)';
    const borderColor = state === 'alert'
        ? 'rgba(255,59,48,0.25)'
        : state === 'positive'
            ? 'rgba(52,199,89,0.3)'
            : state === 'neutral'
                ? 'rgba(10,132,255,0.22)'
                : state === 'warning'
                    ? 'rgba(255,59,48,0.24)'
                    : 'rgba(255,149,0,0.25)';
    const extraSignals = result.signals.filter((signal) => signal !== guidance.ui.message);
    return (_jsxs(motion.div, { initial: { opacity: 0, y: -6, scale: 0.97 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -4, scale: 0.98 }, transition: { duration: 0.2 }, style: {
            marginTop: 10,
            borderRadius: 14,
            background: bgColor,
            border: `1px solid ${borderColor}`,
            overflow: 'hidden',
            boxShadow: isReply ? `inset 3px 0 0 ${accentColor}` : 'none',
        }, children: [_jsxs("div", { style: {
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 12px 8px',
                    borderBottom: `0.5px solid ${borderColor}`,
                }, children: [state === 'alert' ? (_jsxs("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: accentColor, strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("path", { d: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" }), _jsx("line", { x1: "12", y1: "9", x2: "12", y2: "13" }), _jsx("line", { x1: "12", y1: "17", x2: "12.01", y2: "17" })] })) : state === 'positive' ? (_jsx("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: accentColor, strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", children: _jsx("path", { d: "M20 6L9 17l-5-5" }) })) : (_jsxs("svg", { width: "13", height: "13", viewBox: "0 0 24 24", fill: "none", stroke: accentColor, strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", children: [_jsx("circle", { cx: "12", cy: "12", r: "10" }), _jsx("line", { x1: "12", y1: "8", x2: "12", y2: "12" }), _jsx("line", { x1: "12", y1: "16", x2: "12.01", y2: "16" })] })), _jsx("span", { style: { fontSize: 11, fontWeight: 800, color: accentColor, textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }, children: guidance.ui.title }), _jsx("button", { onClick: onDismiss, style: { background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: accentColor, opacity: 0.55, fontSize: 18, lineHeight: 1 }, "aria-label": "Dismiss", children: "\u00D7" })] }), _jsxs("div", { style: { padding: '9px 12px 11px', display: 'flex', flexDirection: 'column', gap: 8 }, children: [isReply && parentSnippet && (_jsxs("div", { style: {
                            padding: '7px 10px',
                            borderRadius: 9,
                            background: 'rgba(0,0,0,0.04)',
                            borderLeft: `2px solid ${accentColor}`,
                        }, children: [_jsx("p", { style: { margin: '0 0 3px', fontSize: 10, fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: 0.4 }, children: "Replying to" }), _jsxs("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-2)', lineHeight: 1.4, fontStyle: 'italic' }, children: ["\"", parentSnippet.length > 120 ? `${parentSnippet.slice(0, 117)}…` : parentSnippet, "\""] })] })), guidance.ui.message && (_jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-1)', lineHeight: 1.45 }, children: guidance.ui.message })), result.parentSignals.length > 0 && (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 3 }, children: result.parentSignals.map((signal, index) => (_jsxs("div", { style: { display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'flex-start' }, children: [_jsx("span", { style: { fontSize: 10, color: accentColor, marginTop: 2, flexShrink: 0 }, children: "\u203A" }), _jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-3)', lineHeight: 1.4 }, children: signal })] }, index))) })), result.parentSignals.length > 0 && extraSignals.length > 0 && (_jsx("div", { style: { height: 1, background: borderColor } })), extraSignals.length > 0 && (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: extraSignals.map((signal, index) => (_jsx("p", { style: { margin: 0, fontSize: 12, color: 'var(--label-2)', lineHeight: 1.4 }, children: signal }, index))) })), guidance.ui.suggestion && (_jsx("div", { style: {
                            padding: '8px 10px',
                            borderRadius: 10,
                            background: 'rgba(255,255,255,0.04)',
                            border: `1px solid ${borderColor}`,
                        }, children: _jsx("p", { style: { margin: 0, fontSize: 11, color: 'var(--label-3)', lineHeight: 1.4 }, children: guidance.ui.suggestion }) })), guidance.ui.badges.length > 0 && (_jsx("div", { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }, children: guidance.ui.badges.map((badge) => (_jsx("span", { style: {
                                fontSize: 10,
                                fontWeight: 700,
                                color: accentColor,
                                background: state === 'positive' ? 'rgba(52,199,89,0.14)' : 'rgba(255,255,255,0.05)',
                                border: `1px solid ${state === 'positive' ? 'rgba(52,199,89,0.26)' : borderColor}`,
                                borderRadius: 999,
                                padding: '2px 8px',
                            }, children: badge }, badge))) })), guidance.ui.footnote && (_jsx("p", { style: { margin: 0, fontSize: 11, color: 'var(--label-4)', fontStyle: 'italic' }, children: guidance.ui.footnote }))] })] }));
}
//# sourceMappingURL=ComposerGuidanceBanner.js.map