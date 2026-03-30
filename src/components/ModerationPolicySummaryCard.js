import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useMemo, useState } from 'react';
import { useContentFilterStore } from '../store/contentFilterStore.js';
import { useContentFilterMetricsStore } from '../store/contentFilterMetricsStore.js';
import { useSensitiveMediaStore } from '../store/sensitiveMediaStore.js';
import { useGetBlocks, useGetMutes } from '../lib/atproto/queries.js';
function isRuleActive(rule, now) {
    if (!rule.enabled)
        return false;
    if (!rule.expiresAt)
        return true;
    const parsed = Date.parse(rule.expiresAt);
    return Number.isFinite(parsed) && parsed > now;
}
function formatPhraseLabel(phrase) {
    return phrase.startsWith('#') ? phrase : `"${phrase}"`;
}
export default function ModerationPolicySummaryCard() {
    const rules = useContentFilterStore((state) => state.rules);
    const policy = useSensitiveMediaStore((state) => state.policy);
    const filteredCountByRuleId = useContentFilterMetricsStore((state) => state.filteredCountByRuleId);
    const { data: blocksData } = useGetBlocks();
    const { data: mutesData } = useGetMutes();
    const [showSuggestions, setShowSuggestions] = useState(false);
    const now = Date.now();
    const reportGeneratedAt = useMemo(() => new Date(now).toLocaleString(), [now]);
    const activeRules = useMemo(() => rules.filter((rule) => isRuleActive(rule, now)), [rules, now]);
    const blockedCount = blocksData?.data.blocks.length ?? 0;
    const mutedCount = mutesData?.data.mutes.length ?? 0;
    // Total filtered this session = sum of all per-rule counts
    const totalFiltered = useMemo(() => Object.values(filteredCountByRuleId).reduce((sum, n) => sum + n, 0), [filteredCountByRuleId]);
    // Top triggered rules — join counts back to rule phrases
    const topTriggeredRules = useMemo(() => {
        const ruleMap = new Map(rules.map((r) => [r.id, r]));
        return Object.entries(filteredCountByRuleId)
            .map(([ruleId, count]) => {
            const rule = ruleMap.get(ruleId);
            return rule ? { phrase: rule.phrase, action: rule.action, count } : null;
        })
            .filter((entry) => entry !== null)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }, [filteredCountByRuleId, rules]);
    const warnCount = activeRules.filter((r) => r.action === 'warn').length;
    const hideCount = activeRules.filter((r) => r.action === 'hide').length;
    const semanticCount = activeRules.filter((r) => r.semantic).length;
    const expiring7d = useMemo(() => {
        const weekAhead = now + 7 * 24 * 60 * 60 * 1000;
        return activeRules.filter((rule) => {
            if (!rule.expiresAt)
                return false;
            const at = Date.parse(rule.expiresAt);
            return Number.isFinite(at) && at > now && at <= weekAhead;
        }).length;
    }, [activeRules, now]);
    // Unused rules: active but triggered 0 times this session (and session has data)
    const unusedActiveRules = useMemo(() => {
        if (totalFiltered === 0)
            return 0;
        return activeRules.filter((rule) => !filteredCountByRuleId[rule.id]).length;
    }, [activeRules, filteredCountByRuleId, totalFiltered]);
    // Generate suggestions
    const suggestions = useMemo(() => {
        const list = [];
        if (unusedActiveRules > 0) {
            list.push(`${unusedActiveRules} active filter rule${unusedActiveRules === 1 ? '' : 's'} haven't matched any content this session. Consider reviewing or removing them to keep your list focused.`);
        }
        if (hideCount === 0 && warnCount > 0 && totalFiltered > 10) {
            list.push('All your filters are set to Warn. If high-frequency content is disruptive, consider switching top-matched rules to Hide.');
        }
        if (semanticCount === 0 && activeRules.length > 0) {
            list.push('None of your rules use semantic matching. Enabling it on key rules catches paraphrased content that exact keywords miss.');
        }
        if (expiring7d > 0) {
            list.push(`${expiring7d} rule${expiring7d === 1 ? '' : 's'} expire within the next 7 days. Review them if you want to keep them active.`);
        }
        if (blockedCount > 20) {
            list.push(`You have ${blockedCount} blocked accounts. Periodic reviews help keep the list relevant.`);
        }
        if (mutedCount > 20) {
            list.push(`You have ${mutedCount} muted accounts. Some may have timed mutes approaching expiry.`);
        }
        return list;
    }, [unusedActiveRules, hideCount, warnCount, totalFiltered, semanticCount, activeRules.length, expiring7d, blockedCount, mutedCount]);
    return (_jsxs("div", { style: {
            border: '1px solid var(--sep)',
            borderRadius: 12,
            padding: '10px 12px',
            background: 'var(--fill-1)',
            marginBottom: 12,
        }, children: [_jsxs("div", { style: { marginBottom: 8 }, children: [_jsx("p", { style: { fontSize: 12, fontWeight: 700, color: 'var(--label-1)', marginBottom: 2 }, children: "Your moderation report" }), _jsxs("p", { style: { fontSize: 10, color: 'var(--label-4)' }, children: ["Generated ", reportGeneratedAt] })] }), _jsxs("div", { style: {
                    background: 'var(--surface)',
                    border: '1px solid var(--sep)',
                    borderRadius: 8,
                    padding: '6px 9px',
                    marginBottom: 10,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                }, children: [_jsx("span", { style: { fontSize: 13, lineHeight: 1, marginTop: 1 }, children: "\uD83D\uDD12" }), _jsx("p", { style: { fontSize: 10, color: 'var(--label-3)', lineHeight: 1.45 }, children: "This report is computed entirely on your device. No filter activity, keyword data, or account lists are shared with anyone. Only you can see this." })] }), _jsxs("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: 6,
                    marginBottom: 10,
                }, children: [_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }, children: [_jsx("p", { style: { fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }, children: "Filtered this session" }), _jsx("p", { style: { fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }, children: totalFiltered })] }), _jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }, children: [_jsx("p", { style: { fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }, children: "Blocked accounts" }), _jsx("p", { style: { fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }, children: blockedCount })] }), _jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }, children: [_jsx("p", { style: { fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }, children: "Muted accounts" }), _jsx("p", { style: { fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }, children: mutedCount })] })] }), _jsxs("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                    gap: 6,
                    marginBottom: 10,
                }, children: [_jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }, children: [_jsx("p", { style: { fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }, children: "Active rules" }), _jsx("p", { style: { fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }, children: activeRules.length })] }), _jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }, children: [_jsx("p", { style: { fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }, children: "Warn / Hide" }), _jsxs("p", { style: { fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }, children: [warnCount, " / ", hideCount] })] }), _jsxs("div", { style: { border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }, children: [_jsx("p", { style: { fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }, children: "Blur sensitive" }), _jsx("p", { style: { fontSize: 16, fontWeight: 700, color: policy.blurSensitiveMedia ? 'var(--label-1)' : 'var(--label-4)', lineHeight: 1 }, children: policy.blurSensitiveMedia ? 'On' : 'Off' })] })] }), _jsxs("div", { style: {
                    border: '1px solid var(--sep)',
                    borderRadius: 9,
                    padding: '8px 10px',
                    background: 'var(--surface)',
                    marginBottom: 10,
                }, children: [_jsx("p", { style: { fontSize: 11, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }, children: "Most active filters this session" }), topTriggeredRules.length === 0 ? (_jsx("p", { style: { fontSize: 11, color: 'var(--label-4)' }, children: "No filter matches recorded yet. Matches accumulate as you browse." })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: topTriggeredRules.map((entry) => (_jsxs("div", { style: {
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 8,
                            }, children: [_jsx("span", { style: { fontSize: 11, color: 'var(--label-1)', fontWeight: 600 }, children: formatPhraseLabel(entry.phrase) }), _jsxs("span", { style: {
                                        fontSize: 10,
                                        color: entry.action === 'hide' ? 'var(--red)' : 'var(--orange)',
                                        fontWeight: 700,
                                    }, children: [entry.count, " match", entry.count === 1 ? '' : 'es', " \u00B7 ", entry.action] })] }, entry.phrase))) }))] }), suggestions.length > 0 && (_jsxs("div", { style: {
                    border: '1px solid var(--sep)',
                    borderRadius: 9,
                    padding: '8px 10px',
                    background: 'var(--surface)',
                    marginBottom: 10,
                }, children: [_jsxs("div", { style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: showSuggestions ? 8 : 0,
                        }, children: [_jsxs("p", { style: { fontSize: 11, fontWeight: 700, color: 'var(--label-2)' }, children: ["Suggestions (", suggestions.length, ")"] }), _jsx("button", { type: "button", onClick: () => setShowSuggestions((prev) => !prev), style: {
                                    border: '1px solid var(--sep)',
                                    background: 'transparent',
                                    color: 'var(--label-3)',
                                    borderRadius: 7,
                                    padding: '3px 7px',
                                    fontSize: 10,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                }, children: showSuggestions ? 'Hide' : 'Show' })] }), showSuggestions && (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: suggestions.map((text, i) => (_jsxs("div", { style: {
                                display: 'flex',
                                gap: 6,
                                alignItems: 'flex-start',
                            }, children: [_jsx("span", { style: { fontSize: 11, color: 'var(--label-4)', marginTop: 1, flexShrink: 0 }, children: "\u00B7" }), _jsx("p", { style: { fontSize: 11, color: 'var(--label-2)', lineHeight: 1.45 }, children: text })] }, i))) }))] })), _jsx("p", { style: { fontSize: 10, color: 'var(--label-4)', lineHeight: 1.4, textAlign: 'center' }, children: "All data in this report stays on your device and is never transmitted." })] }));
}
//# sourceMappingURL=ModerationPolicySummaryCard.js.map