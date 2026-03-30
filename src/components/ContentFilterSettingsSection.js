import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useMemo, useState } from 'react';
import { useContentFilterStore } from '../store/contentFilterStore.js';
import { useContentFilterMetricsStore } from '../store/contentFilterMetricsStore.js';
import { useSessionStore } from '../store/sessionStore.js';
import { useSyncMutedWords, useImportMutedWords } from '../lib/atproto/queries.js';
const CONTEXT_OPTIONS = [
    { value: 'home', label: 'Home feed' },
    { value: 'explore', label: 'Explore + Search' },
    { value: 'profile', label: 'Profiles' },
    { value: 'thread', label: 'Conversations' },
];
const EXPIRY_OPTIONS = [
    { value: 'never', label: 'Never expires' },
    { value: '1h', label: '1 hour' },
    { value: '6h', label: '6 hours' },
    { value: '1d', label: '1 day' },
    { value: '1w', label: '1 week' },
];
const THRESHOLD_OPTIONS = [
    { value: 0.66, label: 'Broad (0.66)' },
    { value: 0.72, label: 'Balanced (0.72)' },
    { value: 0.78, label: 'Strict (0.78)' },
];
function thresholdDescriptor(value) {
    if (value <= 0.66)
        return 'Broad catches more similar wording, but may include more false positives.';
    if (value >= 0.78)
        return 'Strict is precise and conservative, but can miss loosely related phrasing.';
    return 'Balanced is a middle ground between recall and precision.';
}
function computeExpiresAt(option) {
    const now = Date.now();
    if (option === 'never')
        return null;
    if (option === '1h')
        return new Date(now + 60 * 60 * 1000).toISOString();
    if (option === '6h')
        return new Date(now + 6 * 60 * 60 * 1000).toISOString();
    if (option === '1d')
        return new Date(now + 24 * 60 * 60 * 1000).toISOString();
    if (option === '1w')
        return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    return null;
}
function ActionChip({ action }) {
    const color = action === 'hide' ? 'var(--red)' : 'var(--orange)';
    return (_jsx("span", { style: {
            fontSize: 10,
            fontWeight: 700,
            borderRadius: 999,
            border: `1px solid ${color}`,
            color,
            padding: '2px 7px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
        }, children: action }));
}
function sanitizeForConfirmLabel(value) {
    const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!cleaned)
        return 'this filter';
    return cleaned.length > 80 ? `${cleaned.slice(0, 80)}...` : cleaned;
}
function previewPhrase(value) {
    const cleaned = sanitizeForConfirmLabel(value);
    return cleaned === 'this filter' ? 'keyword' : cleaned;
}
function sortableCreatedAt(value) {
    if (!value)
        return 0;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
export default function ContentFilterSettingsSection() {
    const { rules, addRule, removeRule, toggleRule, updateRule } = useContentFilterStore();
    const filteredCountByRuleId = useContentFilterMetricsStore((state) => state.filteredCountByRuleId);
    const resetFilterCounts = useContentFilterMetricsStore((state) => state.resetCounts);
    const { session } = useSessionStore();
    const syncMutation = useSyncMutedWords();
    const importMutation = useImportMutedWords();
    const [syncStatus, setSyncStatus] = useState(null);
    const [phrase, setPhrase] = useState('');
    const [wholeWord, setWholeWord] = useState(false);
    const [action, setAction] = useState('warn');
    const [semantic, setSemantic] = useState(true);
    const [threshold, setThreshold] = useState(0.72);
    const [expiry, setExpiry] = useState('never');
    const [contexts, setContexts] = useState(['home']);
    const [editingId, setEditingId] = useState(null);
    const [editPhrase, setEditPhrase] = useState('');
    const [editWholeWord, setEditWholeWord] = useState(false);
    const [editAction, setEditAction] = useState('warn');
    const [editSemantic, setEditSemantic] = useState(true);
    const [editThreshold, setEditThreshold] = useState(0.72);
    const [editExpiry, setEditExpiry] = useState('never');
    const [editContexts, setEditContexts] = useState(['home']);
    const [createError, setCreateError] = useState(null);
    const [editError, setEditError] = useState(null);
    const sortedRules = useMemo(() => [...rules].sort((a, b) => {
        const delta = sortableCreatedAt(b.createdAt) - sortableCreatedAt(a.createdAt);
        if (delta !== 0)
            return delta;
        return a.id.localeCompare(b.id);
    }), [rules]);
    const editingMeta = useMemo(() => {
        if (!editingId)
            return null;
        const index = sortedRules.findIndex((rule) => rule.id === editingId);
        if (index === -1)
            return null;
        const activeRule = sortedRules[index];
        if (!activeRule)
            return null;
        return {
            index: index + 1,
            total: sortedRules.length,
            phrase: sanitizeForConfirmLabel(activeRule.phrase),
        };
    }, [editingId, sortedRules]);
    const canCreate = phrase.trim().length > 0 && contexts.length > 0;
    const submit = () => {
        if (!phrase.trim()) {
            setCreateError('Enter a keyword or phrase before adding.');
            return;
        }
        if (contexts.length === 0) {
            setCreateError('Select at least one context.');
            return;
        }
        addRule({
            phrase: phrase.trim(),
            wholeWord,
            action,
            semantic,
            semanticThreshold: threshold,
            contexts,
            expiresAt: computeExpiresAt(expiry),
        });
        setCreateError(null);
        setPhrase('');
        setWholeWord(false);
        setAction('warn');
        setSemantic(true);
        setThreshold(0.72);
        setExpiry('never');
        setContexts(['home']);
    };
    const toggleContext = (ctx) => {
        setContexts((prev) => prev.includes(ctx) ? prev.filter((it) => it !== ctx) : [...prev, ctx]);
    };
    const toggleEditContext = (ctx) => {
        setEditContexts((prev) => prev.includes(ctx) ? prev.filter((it) => it !== ctx) : [...prev, ctx]);
    };
    const deriveExpiryOption = (expiresAt) => {
        if (!expiresAt)
            return 'never';
        const msRemaining = Date.parse(expiresAt) - Date.now();
        if (msRemaining <= 60 * 60 * 1000)
            return '1h';
        if (msRemaining <= 6 * 60 * 60 * 1000)
            return '6h';
        if (msRemaining <= 24 * 60 * 60 * 1000)
            return '1d';
        return '1w';
    };
    const beginEdit = (id) => {
        const rule = rules.find((it) => it.id === id);
        if (!rule)
            return;
        setEditingId(rule.id);
        setEditPhrase(rule.phrase);
        setEditWholeWord(rule.wholeWord);
        setEditAction(rule.action);
        setEditSemantic(rule.semantic);
        setEditThreshold(rule.semanticThreshold);
        setEditExpiry(deriveExpiryOption(rule.expiresAt));
        setEditContexts(rule.contexts);
        setEditError(null);
    };
    const cancelEdit = () => {
        setEditingId(null);
        setEditError(null);
    };
    const saveEdit = (id) => {
        const nextPhrase = editPhrase.trim();
        if (!nextPhrase) {
            setEditError('Phrase cannot be empty.');
            return;
        }
        if (editContexts.length === 0) {
            setEditError('Pick at least one context for this filter.');
            return;
        }
        updateRule(id, {
            phrase: nextPhrase,
            wholeWord: editWholeWord,
            action: editAction,
            semantic: editSemantic,
            semanticThreshold: editThreshold,
            contexts: editContexts,
            expiresAt: computeExpiresAt(editExpiry),
        });
        setEditingId(null);
        setEditError(null);
    };
    const duplicateRule = (id) => {
        const rule = rules.find((it) => it.id === id);
        if (!rule)
            return;
        addRule({
            phrase: rule.phrase,
            wholeWord: rule.wholeWord,
            action: rule.action,
            semantic: rule.semantic,
            semanticThreshold: rule.semanticThreshold,
            contexts: rule.contexts,
            expiresAt: rule.expiresAt,
        });
    };
    const confirmDeleteRule = (id) => {
        const rule = rules.find((it) => it.id === id);
        if (!rule)
            return;
        const label = sanitizeForConfirmLabel(rule.phrase);
        const confirmMessage = `Are you sure you want to delete the filter "${label}"? This cannot be undone.`;
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
            removeRule(id);
            return;
        }
        const confirmed = window.confirm(confirmMessage);
        if (!confirmed)
            return;
        removeRule(id);
    };
    const confirmDisableAllRules = () => {
        const enabledCount = rules.filter((rule) => rule.enabled).length;
        if (enabledCount === 0)
            return;
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
            disableAllRules();
            return;
        }
        const confirmed = window.confirm(`Are you sure you want to disable ${enabledCount} active filter${enabledCount === 1 ? '' : 's'}? You can re-enable them later.`);
        if (!confirmed)
            return;
        disableAllRules();
    };
    const disableAllRules = () => {
        rules.forEach((rule) => {
            if (rule.enabled)
                toggleRule(rule.id, false);
        });
    };
    const handleSyncToAccount = () => {
        setSyncStatus(null);
        syncMutation.mutate(rules, {
            onSuccess: (count) => setSyncStatus(count === 0 ? 'Already up to date.' : `Synced ${count} word${count !== 1 ? 's' : ''} to your account.`),
            onError: () => setSyncStatus('Sync failed — check connection.'),
        });
    };
    const handleImportFromAccount = () => {
        setSyncStatus(null);
        const existing = new Set(rules.map((r) => r.phrase.toLowerCase()));
        importMutation.mutate(existing, {
            onSuccess: (words) => {
                words.forEach((w) => addRule({ phrase: w.value, expiresAt: w.expiresAt ?? null }));
                setSyncStatus(words.length === 0 ? 'Nothing new to import.' : `Imported ${words.length} rule${words.length !== 1 ? 's' : ''}.`);
            },
            onError: () => setSyncStatus('Import failed — check connection.'),
        });
    };
    return (_jsxs("div", { style: { marginTop: 10 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }, children: [_jsx("h4", { style: { fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }, children: "Muted words and semantic filters" }), session && (_jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsx("button", { type: "button", onClick: handleSyncToAccount, disabled: syncMutation.isPending || importMutation.isPending, title: "Push local filter rules to account muted words (cross-device sync)", style: {
                                    height: 26, padding: '0 9px', borderRadius: 7,
                                    border: '1px solid var(--sep)', background: 'var(--fill-1)',
                                    color: 'var(--label-2)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                    opacity: (syncMutation.isPending || importMutation.isPending) ? 0.5 : 1,
                                }, children: syncMutation.isPending ? '…' : '↑ Sync' }), _jsx("button", { type: "button", onClick: handleImportFromAccount, disabled: syncMutation.isPending || importMutation.isPending, title: "Import account muted words into local filter rules", style: {
                                    height: 26, padding: '0 9px', borderRadius: 7,
                                    border: '1px solid var(--sep)', background: 'var(--fill-1)',
                                    color: 'var(--label-2)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                    opacity: (syncMutation.isPending || importMutation.isPending) ? 0.5 : 1,
                                }, children: importMutation.isPending ? '…' : '↓ Import' })] }))] }), _jsx("p", { style: { fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35, marginBottom: syncStatus ? 4 : 10 }, children: "Keyword muted-word filters with optional semantic matching. Warn shows a banner; hide removes matching posts." }), _jsx("p", { style: { fontSize: 11, color: 'var(--label-4)', lineHeight: 1.35, marginBottom: 10 }, children: "Explore + Search context includes Discovery and Search Story surfaces." }), syncStatus && (_jsx("p", { style: { fontSize: 11, color: 'var(--green)', fontWeight: 600, marginBottom: 8 }, children: syncStatus })), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }, children: [_jsx("input", { value: phrase, onChange: (e) => setPhrase(e.target.value), placeholder: "Keyword or phrase", style: {
                            width: '100%',
                            height: 38,
                            borderRadius: 10,
                            border: '1px solid var(--sep)',
                            background: 'var(--fill-1)',
                            color: 'var(--label-1)',
                            padding: '0 10px',
                            fontSize: 13,
                        } }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsxs("select", { value: action, onChange: (e) => setAction(e.target.value), style: { flex: 1, height: 34, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }, children: [_jsx("option", { value: "warn", children: "Warn (show banner)" }), _jsx("option", { value: "hide", children: "Hide completely" })] }), _jsx("select", { value: expiry, onChange: (e) => setExpiry(e.target.value), style: { flex: 1, height: 34, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }, children: EXPIRY_OPTIONS.map((opt) => _jsx("option", { value: opt.value, children: opt.label }, opt.value)) })] }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--label-2)' }, children: [_jsx("input", { type: "checkbox", checked: wholeWord, onChange: (e) => setWholeWord(e.target.checked) }), "Whole word"] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--label-2)' }, children: [_jsx("input", { type: "checkbox", checked: semantic, onChange: (e) => setSemantic(e.target.checked) }), "Semantic match"] })] }), semantic && (_jsxs(_Fragment, { children: [_jsx("select", { value: threshold, onChange: (e) => setThreshold(Number(e.target.value)), style: { height: 34, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }, children: THRESHOLD_OPTIONS.map((opt) => _jsx("option", { value: opt.value, children: opt.label }, opt.value)) }), _jsx("div", { style: { fontSize: 10, color: 'var(--label-4)', lineHeight: 1.3 }, children: thresholdDescriptor(threshold) })] })), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 8 }, children: CONTEXT_OPTIONS.map((ctx) => {
                            const selected = contexts.includes(ctx.value);
                            return (_jsx("button", { type: "button", onClick: () => toggleContext(ctx.value), style: {
                                    borderRadius: 999,
                                    border: `1px solid ${selected ? 'var(--blue)' : 'var(--sep)'}`,
                                    background: selected ? 'rgba(0,122,255,0.12)' : 'var(--fill-1)',
                                    color: selected ? 'var(--blue)' : 'var(--label-2)',
                                    fontSize: 11,
                                    fontWeight: 600,
                                    padding: '5px 9px',
                                    cursor: 'pointer',
                                }, children: ctx.label }, ctx.value));
                        }) }), _jsx("button", { type: "button", disabled: !canCreate, onClick: submit, style: {
                            height: 34,
                            borderRadius: 10,
                            border: 'none',
                            background: canCreate ? 'var(--blue)' : 'var(--fill-3)',
                            color: canCreate ? '#fff' : 'var(--label-4)',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: canCreate ? 'pointer' : 'default',
                        }, children: "Add filter" }), _jsxs("div", { style: {
                            border: '1px solid var(--sep)',
                            borderRadius: 10,
                            padding: '8px 10px',
                            background: 'var(--fill-1)',
                        }, children: [_jsx("div", { style: { fontSize: 10, fontWeight: 700, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }, children: "Preview" }), action === 'warn' ? (_jsxs("div", { children: [_jsxs("p", { style: { fontSize: 12, fontWeight: 700, color: 'var(--label-2)', marginBottom: 4 }, children: ["Matches filter: ", previewPhrase(phrase)] }), _jsx("p", { style: { fontSize: 11, color: 'var(--label-3)' }, children: "The post is collapsed and shows a Show post button in selected contexts." })] })) : (_jsxs("div", { children: [_jsxs("p", { style: { fontSize: 12, fontWeight: 700, color: 'var(--label-2)', marginBottom: 4 }, children: ["Hidden by filter: ", previewPhrase(phrase)] }), _jsx("p", { style: { fontSize: 11, color: 'var(--label-3)' }, children: "Matching posts are removed from the feed in selected contexts." })] }))] }), createError && (_jsx("div", { style: { fontSize: 11, color: 'var(--red)' }, children: createError }))] }), sortedRules.length > 0 && (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }, children: [_jsx("p", { style: { margin: 0, fontSize: 11, color: 'var(--label-4)' }, children: "Counters are session-based and show unique posts matched by each rule." }), _jsxs("div", { style: { display: 'flex', gap: 10, alignItems: 'center' }, children: [_jsx("button", { type: "button", onClick: resetFilterCounts, style: {
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--label-3)',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    padding: 0,
                                }, children: "Reset counters" }), _jsx("button", { type: "button", onClick: confirmDisableAllRules, style: {
                                    border: 'none',
                                    background: 'transparent',
                                    color: 'var(--label-3)',
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    padding: 0,
                                }, children: "Disable all" })] })] })), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [editingMeta && (_jsxs("div", { style: {
                            border: '1px solid rgba(0,122,255,0.35)',
                            borderRadius: 10,
                            padding: '8px 10px',
                            background: 'rgba(0,122,255,0.08)',
                            color: 'var(--blue)',
                            fontSize: 11,
                            fontWeight: 700,
                        }, children: ["Editing filter ", editingMeta.index, " of ", editingMeta.total, ": \"", editingMeta.phrase, "\". Other filters remain unchanged until you save."] })), sortedRules.length === 0 && (_jsx("div", { style: { fontSize: 12, color: 'var(--label-4)' }, children: "No filters yet." })), sortedRules.map((rule) => (_jsx("div", { style: { border: editingId === rule.id ? '1px solid var(--blue)' : '1px solid var(--sep)', borderRadius: 12, padding: '8px 10px', background: 'var(--fill-1)' }, children: editingId === rule.id ? (_jsxs(_Fragment, { children: [_jsx("div", { style: { fontSize: 10, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }, children: "Editing rule" }), _jsx("input", { value: editPhrase, onChange: (e) => setEditPhrase(e.target.value), placeholder: "Keyword or phrase", style: {
                                        width: '100%',
                                        height: 34,
                                        borderRadius: 10,
                                        border: '1px solid var(--sep)',
                                        background: 'var(--fill-1)',
                                        color: 'var(--label-1)',
                                        padding: '0 10px',
                                        fontSize: 12,
                                        marginBottom: 8,
                                    } }), _jsxs("div", { style: { display: 'flex', gap: 8, marginBottom: 8 }, children: [_jsxs("select", { value: editAction, onChange: (e) => setEditAction(e.target.value), style: { flex: 1, height: 32, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }, children: [_jsx("option", { value: "warn", children: "Warn (show banner)" }), _jsx("option", { value: "hide", children: "Hide completely" })] }), _jsx("select", { value: editExpiry, onChange: (e) => setEditExpiry(e.target.value), style: { flex: 1, height: 32, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }, children: EXPIRY_OPTIONS.map((opt) => _jsx("option", { value: opt.value, children: opt.label }, opt.value)) })] }), _jsxs("div", { style: { display: 'flex', gap: 10, marginBottom: 8 }, children: [_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--label-2)' }, children: [_jsx("input", { type: "checkbox", checked: editWholeWord, onChange: (e) => setEditWholeWord(e.target.checked) }), "Whole word"] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--label-2)' }, children: [_jsx("input", { type: "checkbox", checked: editSemantic, onChange: (e) => setEditSemantic(e.target.checked) }), "Semantic"] })] }), editSemantic && (_jsxs(_Fragment, { children: [_jsx("select", { value: editThreshold, onChange: (e) => setEditThreshold(Number(e.target.value)), style: { width: '100%', height: 32, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12, marginBottom: 4 }, children: THRESHOLD_OPTIONS.map((opt) => _jsx("option", { value: opt.value, children: opt.label }, opt.value)) }), _jsx("div", { style: { fontSize: 10, color: 'var(--label-4)', lineHeight: 1.3, marginBottom: 8 }, children: thresholdDescriptor(editThreshold) })] })), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }, children: CONTEXT_OPTIONS.map((ctx) => {
                                        const selected = editContexts.includes(ctx.value);
                                        return (_jsx("button", { type: "button", onClick: () => toggleEditContext(ctx.value), style: {
                                                borderRadius: 999,
                                                border: `1px solid ${selected ? 'var(--blue)' : 'var(--sep)'}`,
                                                background: selected ? 'rgba(0,122,255,0.12)' : 'var(--fill-1)',
                                                color: selected ? 'var(--blue)' : 'var(--label-2)',
                                                fontSize: 10,
                                                fontWeight: 600,
                                                padding: '4px 8px',
                                                cursor: 'pointer',
                                            }, children: ctx.label }, ctx.value));
                                    }) }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--label-3)' }, children: [_jsx("input", { type: "checkbox", checked: rule.enabled, onChange: (e) => toggleRule(rule.id, e.target.checked) }), "On"] }), _jsxs("div", { style: { display: 'flex', gap: 10, alignItems: 'center' }, children: [_jsx("button", { type: "button", onClick: cancelEdit, style: { border: 'none', background: 'transparent', color: 'var(--label-3)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }, children: "Cancel" }), _jsx("button", { type: "button", onClick: () => saveEdit(rule.id), style: { border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }, children: "Save" })] })] }), editError && (_jsx("div", { style: { fontSize: 11, color: 'var(--red)', marginTop: 8 }, children: editError }))] })) : (_jsxs(_Fragment, { children: [(() => {
                                    const filteredCount = filteredCountByRuleId[rule.id] ?? 0;
                                    if (filteredCount === 0)
                                        return null;
                                    return (_jsxs("div", { style: { fontSize: 11, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }, children: [filteredCount, " content", filteredCount === 1 ? '' : 's', " filtered"] }));
                                })(), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }, children: [_jsx(ActionChip, { action: rule.action }), _jsx("span", { style: { fontSize: 13, fontWeight: 600, color: 'var(--label-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: rule.phrase }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--label-3)' }, children: [_jsx("input", { type: "checkbox", checked: rule.enabled, onChange: (e) => toggleRule(rule.id, e.target.checked) }), "On"] })] }), _jsxs("div", { style: { fontSize: 11, color: 'var(--label-3)', marginBottom: 6 }, children: [rule.contexts.join(', '), " \u00B7 ", rule.wholeWord ? 'whole-word' : 'substring', " \u00B7 ", rule.semantic ? `semantic ${rule.semanticThreshold.toFixed(2)}` : 'semantic off'] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("span", { style: { fontSize: 10, color: 'var(--label-4)' }, children: rule.expiresAt ? `Expires ${new Date(rule.expiresAt).toLocaleString()}` : 'No expiry' }), _jsxs("div", { style: { display: 'flex', gap: 10, alignItems: 'center' }, children: [_jsx("button", { type: "button", onClick: () => duplicateRule(rule.id), disabled: Boolean(editingId), style: { border: 'none', background: 'transparent', color: Boolean(editingId) ? 'var(--label-4)' : 'var(--label-3)', fontSize: 11, fontWeight: 700, cursor: Boolean(editingId) ? 'default' : 'pointer', padding: 0 }, children: "Duplicate" }), _jsx("button", { type: "button", onClick: () => beginEdit(rule.id), style: { border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }, children: "Edit" }), _jsx("button", { type: "button", onClick: () => confirmDeleteRule(rule.id), style: { border: 'none', background: 'transparent', color: 'var(--red)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }, children: "Delete" })] })] })] })) }, rule.id)))] })] }));
}
//# sourceMappingURL=ContentFilterSettingsSection.js.map