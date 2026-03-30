import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// ─── ModerationSection ────────────────────────────────────────────────────
// Renders inside the settings sheet. Shows lists of blocked and muted
// accounts with inline unblock/unmute actions.
//
// Timed mutes: the mute form lets users pick a duration;
// the store manages expiry and useTimedMuteWatcher auto-unmutes when expired.
import { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStore } from '../store/sessionStore.js';
import { useGetBlocks, useGetMutes, useUnblockActor, useUnmuteActor, useMuteActor, } from '../lib/atproto/queries.js';
import { useModerationStore, formatMuteExpiry, MUTE_DURATIONS, } from '../store/moderationStore.js';
import { atpCall } from '../lib/atproto/client.js';
// ─── Styles (inline — consistent with the rest of the settings sheet) ─────
const styles = {
    sectionTitle: {
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        margin: '0 0 10px',
    },
    subsectionHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        userSelect: 'none',
        padding: '6px 0',
    },
    subsectionTitle: {
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--text)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
    },
    badge: {
        fontSize: 11,
        fontWeight: 700,
        background: 'var(--accent)',
        color: '#fff',
        borderRadius: 10,
        padding: '1px 6px',
        minWidth: 18,
        textAlign: 'center',
    },
    chevron: (open) => ({
        fontSize: 12,
        color: 'var(--text-muted)',
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 150ms ease',
    }),
    accountRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 0',
        borderBottom: '1px solid var(--sep)',
    },
    avatar: {
        width: 34,
        height: 34,
        borderRadius: '50%',
        background: 'var(--surface-2)',
        flexShrink: 0,
        overflow: 'hidden',
    },
    accountInfo: {
        flex: 1,
        minWidth: 0,
    },
    displayName: {
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--text)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    handle: {
        fontSize: 12,
        color: 'var(--text-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    expiryBadge: (expired) => ({
        fontSize: 11,
        color: expired ? 'var(--destructive)' : 'var(--text-muted)',
        marginTop: 1,
    }),
    actionBtn: (destructive = false) => ({
        fontSize: 12,
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: 6,
        border: `1px solid ${destructive ? 'var(--destructive)' : 'var(--border)'}`,
        background: 'transparent',
        color: destructive ? 'var(--destructive)' : 'var(--text)',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'opacity 150ms',
    }),
    emptyText: {
        fontSize: 13,
        color: 'var(--text-muted)',
        padding: '8px 0 4px',
        textAlign: 'center',
    },
    muteFormRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 0 4px',
    },
    input: {
        flex: 1,
        fontSize: 13,
        padding: '6px 10px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: 'var(--text)',
        minWidth: 0,
    },
    select: {
        fontSize: 12,
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: 'var(--text)',
    },
    submitBtn: {
        fontSize: 12,
        fontWeight: 600,
        padding: '6px 12px',
        borderRadius: 6,
        border: 'none',
        background: 'var(--accent)',
        color: '#fff',
        cursor: 'pointer',
        flexShrink: 0,
    },
};
// ─── Inline actor-search hook ─────────────────────────────────────────────
// Used by the mute-input to show @handle suggestions.
function useActorSearchSuggestions(query) {
    const { agent, session } = useSessionStore();
    const [suggestions, setSuggestions] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const debounceRef = useRef(null);
    const abortRef = useRef(null);
    // Sanitize before sending to the API.
    const sanitize = (q) => q.replace(/[\u0000-\u001F\u007F]/g, '').normalize('NFKC').trim().slice(0, 64);
    useEffect(() => {
        const q = sanitize(query.replace(/^@/, ''));
        if (!q || !session) {
            setSuggestions([]);
            setIsLoading(false);
            return;
        }
        if (debounceRef.current !== null)
            clearTimeout(debounceRef.current);
        abortRef.current?.abort();
        setIsLoading(true);
        debounceRef.current = setTimeout(() => {
            const controller = new AbortController();
            abortRef.current = controller;
            atpCall(() => agent.searchActors({ q, limit: 5 }), { signal: controller.signal, timeoutMs: 5_000, maxAttempts: 1 })
                .then((res) => {
                if (controller.signal.aborted)
                    return;
                setSuggestions(res.data.actors.slice(0, 5).map((a) => ({
                    did: a.did,
                    handle: a.handle,
                    ...(a.displayName ? { displayName: a.displayName } : {}),
                    ...(a.avatar ? { avatar: a.avatar } : {}),
                })));
                setIsLoading(false);
            })
                .catch((err) => {
                if (err?.name === 'AbortError')
                    return;
                if (controller.signal.aborted)
                    return;
                setSuggestions([]);
                setIsLoading(false);
            });
        }, 250);
        return () => {
            if (debounceRef.current !== null)
                clearTimeout(debounceRef.current);
            abortRef.current?.abort();
        };
    }, [query, agent, session]);
    const dismiss = useCallback(() => {
        setSuggestions([]);
        setIsLoading(false);
        if (debounceRef.current !== null)
            clearTimeout(debounceRef.current);
        abortRef.current?.abort();
    }, []);
    return { suggestions, isLoading, dismiss };
}
// ─── Shared actor-suggestion dropdown ─────────────────────────────────────
function ActorSuggestionDropdown({ suggestions, isLoading, selectedIndex, onSelect, onPointerEnterRow, }) {
    if (!isLoading && suggestions.length === 0)
        return null;
    return (_jsxs("div", { role: "listbox", "aria-label": "Account suggestions", style: {
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 100,
            marginTop: 3,
            background: 'var(--surface)',
            border: '0.5px solid var(--sep)',
            borderRadius: 10,
            boxShadow: '0 4px 20px rgba(0,0,0,0.16)',
            overflow: 'hidden',
        }, children: [isLoading && suggestions.length === 0 && (_jsx("div", { style: { padding: '9px 12px', fontSize: 12, color: 'var(--text-muted)' }, children: "Searching\u2026" })), suggestions.map((s, idx) => {
                const initials = (s.displayName?.[0] ?? s.handle[0] ?? '?').toUpperCase();
                return (_jsxs("button", { role: "option", "aria-selected": idx === selectedIndex, onPointerEnter: () => onPointerEnterRow(idx), onPointerDown: (e) => {
                        // Prevent input blur before selection commits.
                        e.preventDefault();
                        onSelect(s);
                    }, style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        width: '100%',
                        padding: '7px 10px',
                        background: idx === selectedIndex ? 'rgba(10,132,255,0.10)' : 'none',
                        border: 'none',
                        borderBottom: idx < suggestions.length - 1 ? '0.5px solid var(--sep)' : 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background 0.1s ease',
                    }, children: [_jsx("div", { style: {
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, var(--accent) 0%, #7c5cbf 100%)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                fontSize: 12,
                                fontWeight: 700,
                                flexShrink: 0,
                                overflow: 'hidden',
                            }, children: s.avatar ? (_jsx("img", { src: s.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' }, loading: "lazy", decoding: "async" })) : (initials) }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [s.displayName && (_jsx("div", { style: {
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: 'var(--text)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }, children: s.displayName })), _jsxs("div", { style: {
                                        fontSize: 12,
                                        color: 'var(--text-muted)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }, children: ["@", s.handle] })] })] }, s.did));
            })] }));
}
// ─── Blocked accounts subsection ─────────────────────────────────────────
function BlockedAccountsSection() {
    const [open, setOpen] = useState(false);
    const { data, isLoading } = useGetBlocks();
    const { mutate: unblock, isPending: unblocking } = useUnblockActor();
    const blocks = data?.data.blocks ?? [];
    return (_jsxs("div", { children: [_jsxs("div", { style: styles.subsectionHeader, onClick: () => setOpen((p) => !p), role: "button", "aria-expanded": open, children: [_jsxs("span", { style: styles.subsectionTitle, children: ["Blocked accounts", blocks.length > 0 && _jsx("span", { style: styles.badge, children: blocks.length })] }), _jsx("span", { style: styles.chevron(open), children: "\u203A" })] }), open && (_jsxs("div", { children: [isLoading && _jsx("p", { style: styles.emptyText, children: "Loading\u2026" }), !isLoading && blocks.length === 0 && (_jsx("p", { style: styles.emptyText, children: "No blocked accounts" })), blocks.map((profile) => (_jsxs("div", { style: styles.accountRow, children: [_jsx("div", { style: styles.avatar, children: profile.avatar && (_jsx("img", { src: profile.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })) }), _jsxs("div", { style: styles.accountInfo, children: [_jsx("div", { style: styles.displayName, children: profile.displayName || profile.handle }), _jsxs("div", { style: styles.handle, children: ["@", profile.handle] })] }), _jsx("button", { style: styles.actionBtn(true), disabled: unblocking, onClick: () => unblock({ did: profile.did }), children: "Unblock" })] }, profile.did)))] }))] }));
}
// ─── Muted accounts subsection ────────────────────────────────────────────
function MutedAccountsSection() {
    const [open, setOpen] = useState(false);
    const [muteHandle, setMuteHandle] = useState('');
    const [muteDuration, setMuteDuration] = useState(null);
    const [acSelectedIndex, setAcSelectedIndex] = useState(0);
    const muteInputRef = useRef(null);
    const { data, isLoading } = useGetMutes();
    const { mutate: unmute, isPending: unmuting } = useUnmuteActor();
    const { mutate: mute, isPending: muting } = useMuteActor();
    const timedMutes = useModerationStore((s) => s.timedMutes);
    const mutes = data?.data.mutes ?? [];
    // Actor search autocomplete for the mute input.
    const { suggestions: acSuggestions, isLoading: acLoading, dismiss: acDismiss, } = useActorSearchSuggestions(muteHandle);
    // Reset selected index when the suggestion list changes.
    useEffect(() => {
        setAcSelectedIndex(0);
    }, [acSuggestions.length]);
    const handleSelectSuggestion = useCallback((s) => {
        setMuteHandle(s.handle);
        acDismiss();
        muteInputRef.current?.focus();
    }, [acDismiss]);
    const handleMuteInputKeyDown = useCallback((e) => {
        if (acSuggestions.length === 0)
            return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setAcSelectedIndex((i) => Math.min(i + 1, acSuggestions.length - 1));
        }
        else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAcSelectedIndex((i) => Math.max(i - 1, 0));
        }
        else if (e.key === 'Enter' || e.key === 'Tab') {
            const s = acSuggestions[acSelectedIndex];
            if (s) {
                e.preventDefault();
                handleSelectSuggestion(s);
            }
        }
        else if (e.key === 'Escape') {
            e.preventDefault();
            acDismiss();
        }
    }, [acSuggestions, acSelectedIndex, handleSelectSuggestion, acDismiss]);
    function handleMuteSubmit(e) {
        e.preventDefault();
        const handle = muteHandle.trim().replace(/^@/, '');
        if (!handle)
            return;
        acDismiss();
        // handle may be a DID or a handle — the API accepts both via actor parameter
        mute({ did: handle, durationMs: muteDuration }, { onSuccess: () => setMuteHandle('') });
    }
    return (_jsxs("div", { children: [_jsxs("div", { style: styles.subsectionHeader, onClick: () => setOpen((p) => !p), role: "button", "aria-expanded": open, children: [_jsxs("span", { style: styles.subsectionTitle, children: ["Muted accounts", mutes.length > 0 && _jsx("span", { style: styles.badge, children: mutes.length })] }), _jsx("span", { style: styles.chevron(open), children: "\u203A" })] }), open && (_jsxs("div", { children: [_jsxs("form", { onSubmit: handleMuteSubmit, style: styles.muteFormRow, children: [_jsxs("div", { style: { position: 'relative', flex: 1, minWidth: 0 }, children: [_jsx("input", { ref: muteInputRef, style: { ...styles.input, flex: undefined, width: '100%' }, placeholder: "@handle or DID", value: muteHandle, onChange: (e) => setMuteHandle(e.target.value), onKeyDown: handleMuteInputKeyDown, onBlur: acDismiss, disabled: muting, "aria-label": "Account to mute", "aria-autocomplete": "list", "aria-expanded": acSuggestions.length > 0 || acLoading, autoComplete: "off", autoCapitalize: "none", autoCorrect: "off", spellCheck: false }), _jsx(ActorSuggestionDropdown, { suggestions: acSuggestions, isLoading: acLoading, selectedIndex: acSelectedIndex, onSelect: handleSelectSuggestion, onPointerEnterRow: setAcSelectedIndex })] }), _jsx("select", { style: styles.select, value: muteDuration ?? 'null', onChange: (e) => setMuteDuration(e.target.value === 'null' ? null : Number(e.target.value)), "aria-label": "Mute duration", children: MUTE_DURATIONS.map((d) => (_jsx("option", { value: d.valueMs ?? 'null', children: d.label }, d.label))) }), _jsx("button", { style: styles.submitBtn, type: "submit", disabled: muting || !muteHandle.trim(), children: "Mute" })] }), isLoading && _jsx("p", { style: styles.emptyText, children: "Loading\u2026" }), !isLoading && mutes.length === 0 && (_jsx("p", { style: styles.emptyText, children: "No muted accounts" })), mutes.map((profile) => {
                        const expiresAt = timedMutes[profile.did] ?? null;
                        const isExpired = expiresAt !== null && expiresAt !== 0 && expiresAt < Date.now();
                        return (_jsxs("div", { style: styles.accountRow, children: [_jsx("div", { style: styles.avatar, children: profile.avatar && (_jsx("img", { src: profile.avatar, alt: "", style: { width: '100%', height: '100%', objectFit: 'cover' } })) }), _jsxs("div", { style: styles.accountInfo, children: [_jsx("div", { style: styles.displayName, children: profile.displayName || profile.handle }), _jsxs("div", { style: styles.handle, children: ["@", profile.handle] }), expiresAt !== null && (_jsx("div", { style: styles.expiryBadge(isExpired), children: formatMuteExpiry(expiresAt) }))] }), _jsx("button", { style: styles.actionBtn(), disabled: unmuting, onClick: () => unmute({ did: profile.did }), children: "Unmute" })] }, profile.did));
                    })] }))] }));
}
// ─── Root export ─────────────────────────────────────────────────────────
export default function ModerationSection() {
    const { session } = useSessionStore();
    if (!session)
        return null;
    return (_jsxs("section", { children: [_jsx("p", { style: styles.sectionTitle, children: "Moderation" }), _jsx(BlockedAccountsSection, {}), _jsx("hr", { style: { border: 0, borderTop: '1px solid var(--sep)', margin: '4px 0' } }), _jsx(MutedAccountsSection, {})] }));
}
//# sourceMappingURL=ModerationSection.js.map