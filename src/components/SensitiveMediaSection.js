import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useState } from 'react';
import { useSensitiveMediaStore } from '../store/sensitiveMediaStore.js';
import { getSensitiveMediaMetricsSnapshot } from '../perf/sensitiveMediaTelemetry.js';
export default function SensitiveMediaSection() {
    const { policy, setPolicy, clearReveals, revealedPostIds } = useSensitiveMediaStore();
    const [metrics, setMetrics] = useState(() => getSensitiveMediaMetricsSnapshot());
    useEffect(() => {
        const timer = setInterval(() => setMetrics(getSensitiveMediaMetricsSnapshot()), 1500);
        return () => clearInterval(timer);
    }, []);
    const confirmResetReveals = () => {
        const revealedCount = Object.keys(revealedPostIds).length;
        if (revealedCount === 0)
            return;
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
            clearReveals();
            return;
        }
        const confirmed = window.confirm(`Are you sure you want to reset ${revealedCount} reveal${revealedCount === 1 ? '' : 's'} for this device?`);
        if (!confirmed)
            return;
        clearReveals();
    };
    return (_jsxs("div", { children: [_jsx("h4", { style: { fontSize: 14, fontWeight: 700, color: 'var(--label-1)', marginBottom: 4 }, children: "Sensitive media" }), _jsx("p", { style: { fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35, marginBottom: 10 }, children: "Blur media flagged as sexual content, nudity, or graphic violence. Reveal is local to your device and can be reset anytime." }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [_jsxs("label", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, children: [_jsx("span", { style: { fontSize: 13, color: 'var(--label-2)', fontWeight: 600 }, children: "Blur sensitive media" }), _jsx("input", { type: "checkbox", checked: policy.blurSensitiveMedia, onChange: (e) => setPolicy({ blurSensitiveMedia: e.target.checked }) })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, children: [_jsx("span", { style: { fontSize: 13, color: 'var(--label-2)', fontWeight: 600 }, children: "Allow tap-to-reveal" }), _jsx("input", { type: "checkbox", checked: policy.allowReveal, onChange: (e) => setPolicy({ allowReveal: e.target.checked }) })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, children: [_jsx("span", { style: { fontSize: 13, color: 'var(--label-2)', fontWeight: 600 }, children: "Share anonymous telemetry" }), _jsx("input", { type: "checkbox", checked: policy.telemetryOptIn, onChange: (e) => setPolicy({ telemetryOptIn: e.target.checked }) })] })] }), _jsx("p", { style: { fontSize: 11, color: 'var(--label-4)', marginTop: 8, lineHeight: 1.35 }, children: "Telemetry never includes text, media URLs, handles, DIDs, or post IDs." }), _jsxs("div", { style: { marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }, children: [_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }, children: [_jsx("div", { style: { fontSize: 11, color: 'var(--label-3)' }, children: "Impressions" }), _jsx("div", { style: { fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }, children: metrics.impressions })] }), _jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 10, padding: 8, background: 'var(--fill-1)' }, children: [_jsx("div", { style: { fontSize: 11, color: 'var(--label-3)' }, children: "Reveals" }), _jsx("div", { style: { fontSize: 14, fontWeight: 800, color: 'var(--label-1)' }, children: metrics.reveals })] })] }), _jsxs("div", { style: { marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, children: [_jsxs("span", { style: { fontSize: 12, color: 'var(--label-3)' }, children: ["Revealed posts this session: ", Object.keys(revealedPostIds).length] }), _jsx("button", { type: "button", onClick: confirmResetReveals, style: {
                            border: '1px solid var(--sep)',
                            borderRadius: 8,
                            background: 'var(--fill-1)',
                            color: 'var(--label-2)',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '4px 8px',
                            cursor: 'pointer',
                        }, children: "Reset reveals" })] })] }));
}
//# sourceMappingURL=SensitiveMediaSection.js.map