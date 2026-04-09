import React, { useMemo, useState } from 'react';
import { useContentFilterStore } from '../store/contentFilterStore';
import { useContentFilterMetricsStore } from '../store/contentFilterMetricsStore';
import type { FilterContext, FilterAction } from '../lib/contentFilters/types';
import { useSessionStore } from '../store/sessionStore';
import { useSyncMutedWords, useImportMutedWords } from '../lib/atproto/queries';

const CONTEXT_OPTIONS: Array<{ value: FilterContext; label: string }> = [
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
] as const;

const THRESHOLD_OPTIONS = [
  { value: 0.66, label: 'Broad (0.66)' },
  { value: 0.72, label: 'Balanced (0.72)' },
  { value: 0.78, label: 'Strict (0.78)' },
] as const;

function thresholdDescriptor(value: number): string {
  if (value <= 0.66) return 'Broad catches more similar wording, but may include more false positives.';
  if (value >= 0.78) return 'Strict is precise and conservative, but can miss loosely related phrasing.';
  return 'Balanced is a middle ground between recall and precision.';
}

function computeExpiresAt(option: string): string | null {
  const now = Date.now();
  if (option === 'never') return null;
  if (option === '1h') return new Date(now + 60 * 60 * 1000).toISOString();
  if (option === '6h') return new Date(now + 6 * 60 * 60 * 1000).toISOString();
  if (option === '1d') return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (option === '1w') return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

function ActionChip({ action }: { action: FilterAction }) {
  const color = action === 'hide' ? 'var(--red)' : 'var(--orange)';
  return (
    <span style={{
      fontSize: 10,
      fontWeight: 700,
      borderRadius: 999,
      border: `1px solid ${color}`,
      color,
      padding: '2px 7px',
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
    }}>
      {action}
    </span>
  );
}

function sanitizeForConfirmLabel(value: string): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!cleaned) return 'this filter';
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}...` : cleaned;
}

function previewPhrase(value: string): string {
  const cleaned = sanitizeForConfirmLabel(value);
  return cleaned === 'this filter' ? 'keyword' : cleaned;
}

function sortableCreatedAt(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function ContentFilterSettingsSection() {
  const {
    rules,
    excludeFollowingFromFilters,
    addRule,
    removeRule,
    toggleRule,
    updateRule,
    setExcludeFollowingFromFilters,
  } = useContentFilterStore();
  const filteredCountByRuleId = useContentFilterMetricsStore((state) => state.filteredCountByRuleId);
  const resetFilterCounts = useContentFilterMetricsStore((state) => state.resetCounts);
  const { session } = useSessionStore();
  const syncMutation = useSyncMutedWords();
  const importMutation = useImportMutedWords();
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const [phrase, setPhrase] = useState('');
  const [wholeWord, setWholeWord] = useState(false);
  const [action, setAction] = useState<FilterAction>('warn');
  const [semantic, setSemantic] = useState(true);
  const [threshold, setThreshold] = useState(0.72);
  const [expiry, setExpiry] = useState<string>('never');
  const [contexts, setContexts] = useState<FilterContext[]>(['home']);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPhrase, setEditPhrase] = useState('');
  const [editWholeWord, setEditWholeWord] = useState(false);
  const [editAction, setEditAction] = useState<FilterAction>('warn');
  const [editSemantic, setEditSemantic] = useState(true);
  const [editThreshold, setEditThreshold] = useState(0.72);
  const [editExpiry, setEditExpiry] = useState<string>('never');
  const [editContexts, setEditContexts] = useState<FilterContext[]>(['home']);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => {
      const delta = sortableCreatedAt(b.createdAt) - sortableCreatedAt(a.createdAt);
      if (delta !== 0) return delta;
      return a.id.localeCompare(b.id);
    }),
    [rules],
  );

  const editingMeta = useMemo(() => {
    if (!editingId) return null;
    const index = sortedRules.findIndex((rule) => rule.id === editingId);
    if (index === -1) return null;
    const activeRule = sortedRules[index];
    if (!activeRule) return null;
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

  const toggleContext = (ctx: FilterContext) => {
    setContexts((prev) => prev.includes(ctx) ? prev.filter((it) => it !== ctx) : [...prev, ctx]);
  };

  const toggleEditContext = (ctx: FilterContext) => {
    setEditContexts((prev) => prev.includes(ctx) ? prev.filter((it) => it !== ctx) : [...prev, ctx]);
  };

  const deriveExpiryOption = (expiresAt: string | null) => {
    if (!expiresAt) return 'never';
    const msRemaining = Date.parse(expiresAt) - Date.now();
    if (msRemaining <= 60 * 60 * 1000) return '1h';
    if (msRemaining <= 6 * 60 * 60 * 1000) return '6h';
    if (msRemaining <= 24 * 60 * 60 * 1000) return '1d';
    return '1w';
  };

  const beginEdit = (id: string) => {
    const rule = rules.find((it) => it.id === id);
    if (!rule) return;
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

  const saveEdit = (id: string) => {
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

  const duplicateRule = (id: string) => {
    const rule = rules.find((it) => it.id === id);
    if (!rule) return;
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

  const confirmDeleteRule = (id: string) => {
    const rule = rules.find((it) => it.id === id);
    if (!rule) return;
    const label = sanitizeForConfirmLabel(rule.phrase);
    const confirmMessage = `Are you sure you want to delete the filter "${label}"? This cannot be undone.`;
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      removeRule(id);
      return;
    }
    const confirmed = window.confirm(
      confirmMessage,
    );
    if (!confirmed) return;
    removeRule(id);
  };

  const confirmDisableAllRules = () => {
    const enabledCount = rules.filter((rule) => rule.enabled).length;
    if (enabledCount === 0) return;
    if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
      disableAllRules();
      return;
    }
    const confirmed = window.confirm(
      `Are you sure you want to disable ${enabledCount} active filter${enabledCount === 1 ? '' : 's'}? You can re-enable them later.`,
    );
    if (!confirmed) return;
    disableAllRules();
  };

  const disableAllRules = () => {
    rules.forEach((rule) => {
      if (rule.enabled) toggleRule(rule.id, false);
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

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--label-1)' }}>
          Muted words and semantic filters
        </h4>
        {session && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={handleSyncToAccount}
              disabled={syncMutation.isPending || importMutation.isPending}
              title="Push local filter rules to account muted words (cross-device sync)"
              style={{
                height: 26, padding: '0 9px', borderRadius: 7,
                border: '1px solid var(--sep)', background: 'var(--fill-1)',
                color: 'var(--label-2)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                opacity: (syncMutation.isPending || importMutation.isPending) ? 0.5 : 1,
              }}
            >
              {syncMutation.isPending ? '…' : '↑ Sync'}
            </button>
            <button
              type="button"
              onClick={handleImportFromAccount}
              disabled={syncMutation.isPending || importMutation.isPending}
              title="Import account muted words into local filter rules"
              style={{
                height: 26, padding: '0 9px', borderRadius: 7,
                border: '1px solid var(--sep)', background: 'var(--fill-1)',
                color: 'var(--label-2)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                opacity: (syncMutation.isPending || importMutation.isPending) ? 0.5 : 1,
              }}
            >
              {importMutation.isPending ? '…' : '↓ Import'}
            </button>
          </div>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--label-3)', lineHeight: 1.35, marginBottom: syncStatus ? 4 : 10 }}>
        Keyword muted-word filters with optional semantic matching. Warn shows a banner; hide removes matching posts.
      </p>
      <p style={{ fontSize: 11, color: 'var(--label-4)', lineHeight: 1.35, marginBottom: 10 }}>
        Explore + Search context includes Discovery and Search Story surfaces.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, color: 'var(--label-2)' }}>
        <input
          type="checkbox"
          checked={excludeFollowingFromFilters}
          onChange={(e) => setExcludeFollowingFromFilters(e.target.checked)}
        />
        Exclude people you follow (skip keyword filters for followed accounts)
      </label>
      {syncStatus && (
        <p style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginBottom: 8 }}>{syncStatus}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        <input
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="Keyword or phrase"
          style={{
            width: '100%',
            height: 38,
            borderRadius: 10,
            border: '1px solid var(--sep)',
            background: 'var(--fill-1)',
            color: 'var(--label-1)',
            padding: '0 10px',
            fontSize: 13,
          }}
        />

        <div style={{ display: 'flex', gap: 8 }}>
          <select value={action} onChange={(e) => setAction(e.target.value as FilterAction)} style={{ flex: 1, height: 34, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }}>
            <option value="warn">Warn (show banner)</option>
            <option value="hide">Hide completely</option>
          </select>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={{ flex: 1, height: 34, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }}>
            {EXPIRY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--label-2)' }}>
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
            Whole word
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--label-2)' }}>
            <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} />
            Semantic match
          </label>
        </div>

        {semantic && (
          <>
            <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={{ height: 34, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }}>
              {THRESHOLD_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <div style={{ fontSize: 10, color: 'var(--label-4)', lineHeight: 1.3 }}>
              {thresholdDescriptor(threshold)}
            </div>
          </>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {CONTEXT_OPTIONS.map((ctx) => {
            const selected = contexts.includes(ctx.value);
            return (
              <button
                key={ctx.value}
                type="button"
                onClick={() => toggleContext(ctx.value)}
                style={{
                  borderRadius: 999,
                  border: `1px solid ${selected ? 'var(--blue)' : 'var(--sep)'}`,
                  background: selected ? 'rgba(0,122,255,0.12)' : 'var(--fill-1)',
                  color: selected ? 'var(--blue)' : 'var(--label-2)',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '5px 9px',
                  cursor: 'pointer',
                }}
              >
                {ctx.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={!canCreate}
          onClick={submit}
          style={{
            height: 34,
            borderRadius: 10,
            border: 'none',
            background: canCreate ? 'var(--blue)' : 'var(--fill-3)',
            color: canCreate ? '#fff' : 'var(--label-4)',
            fontSize: 12,
            fontWeight: 700,
            cursor: canCreate ? 'pointer' : 'default',
          }}
        >
          Add filter
        </button>

        <div
          style={{
            border: '1px solid var(--sep)',
            borderRadius: 10,
            padding: '8px 10px',
            background: 'var(--fill-1)',
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--label-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
            Preview
          </div>
          {action === 'warn' ? (
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-2)', marginBottom: 4 }}>
                Matches filter: {previewPhrase(phrase)}
              </p>
              <p style={{ fontSize: 11, color: 'var(--label-3)' }}>
                The post is collapsed and shows a Show post button in selected contexts.
              </p>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-2)', marginBottom: 4 }}>
                Hidden by filter: {previewPhrase(phrase)}
              </p>
              <p style={{ fontSize: 11, color: 'var(--label-3)' }}>
                Matching posts are removed from the feed in selected contexts.
              </p>
            </div>
          )}
        </div>

        {createError && (
          <div style={{ fontSize: 11, color: 'var(--red)' }}>{createError}</div>
        )}
      </div>

      {sortedRules.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--label-4)' }}>
            Counters are session-based and show unique posts matched by each rule.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              onClick={resetFilterCounts}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--label-3)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Reset counters
            </button>
            <button
              type="button"
              onClick={confirmDisableAllRules}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--label-3)',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Disable all
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {editingMeta && (
          <div
            style={{
              border: '1px solid rgba(0,122,255,0.35)',
              borderRadius: 10,
              padding: '8px 10px',
              background: 'rgba(0,122,255,0.08)',
              color: 'var(--blue)',
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            Editing filter {editingMeta.index} of {editingMeta.total}: "{editingMeta.phrase}". Other filters remain unchanged until you save.
          </div>
        )}
        {sortedRules.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--label-4)' }}>No filters yet.</div>
        )}
        {sortedRules.map((rule) => (
          <div key={rule.id} style={{ border: editingId === rule.id ? '1px solid var(--blue)' : '1px solid var(--sep)', borderRadius: 12, padding: '8px 10px', background: 'var(--fill-1)' }}>
            {editingId === rule.id ? (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                  Editing rule
                </div>
                <input
                  value={editPhrase}
                  onChange={(e) => setEditPhrase(e.target.value)}
                  placeholder="Keyword or phrase"
                  style={{
                    width: '100%',
                    height: 34,
                    borderRadius: 10,
                    border: '1px solid var(--sep)',
                    background: 'var(--fill-1)',
                    color: 'var(--label-1)',
                    padding: '0 10px',
                    fontSize: 12,
                    marginBottom: 8,
                  }}
                />

                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <select value={editAction} onChange={(e) => setEditAction(e.target.value as FilterAction)} style={{ flex: 1, height: 32, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }}>
                    <option value="warn">Warn (show banner)</option>
                    <option value="hide">Hide completely</option>
                  </select>
                  <select value={editExpiry} onChange={(e) => setEditExpiry(e.target.value)} style={{ flex: 1, height: 32, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12 }}>
                    {EXPIRY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--label-2)' }}>
                    <input type="checkbox" checked={editWholeWord} onChange={(e) => setEditWholeWord(e.target.checked)} />
                    Whole word
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--label-2)' }}>
                    <input type="checkbox" checked={editSemantic} onChange={(e) => setEditSemantic(e.target.checked)} />
                    Semantic
                  </label>
                </div>

                {editSemantic && (
                  <>
                    <select value={editThreshold} onChange={(e) => setEditThreshold(Number(e.target.value))} style={{ width: '100%', height: 32, borderRadius: 10, border: '1px solid var(--sep)', background: 'var(--fill-1)', color: 'var(--label-1)', padding: '0 8px', fontSize: 12, marginBottom: 4 }}>
                      {THRESHOLD_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    <div style={{ fontSize: 10, color: 'var(--label-4)', lineHeight: 1.3, marginBottom: 8 }}>
                      {thresholdDescriptor(editThreshold)}
                    </div>
                  </>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {CONTEXT_OPTIONS.map((ctx) => {
                    const selected = editContexts.includes(ctx.value);
                    return (
                      <button
                        key={ctx.value}
                        type="button"
                        onClick={() => toggleEditContext(ctx.value)}
                        style={{
                          borderRadius: 999,
                          border: `1px solid ${selected ? 'var(--blue)' : 'var(--sep)'}`,
                          background: selected ? 'rgba(0,122,255,0.12)' : 'var(--fill-1)',
                          color: selected ? 'var(--blue)' : 'var(--label-2)',
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '4px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        {ctx.label}
                      </button>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--label-3)' }}>
                    <input type="checkbox" checked={rule.enabled} onChange={(e) => toggleRule(rule.id, e.target.checked)} />
                    On
                  </label>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button type="button" onClick={cancelEdit} style={{ border: 'none', background: 'transparent', color: 'var(--label-3)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                      Cancel
                    </button>
                    <button type="button" onClick={() => saveEdit(rule.id)} style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                      Save
                    </button>
                  </div>
                </div>

                {editError && (
                  <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{editError}</div>
                )}
              </>
            ) : (
              <>
                {(() => {
                  const filteredCount = filteredCountByRuleId[rule.id] ?? 0;
                  if (filteredCount === 0) return null;
                  return (
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }}>
                      {filteredCount} content{filteredCount === 1 ? '' : 's'} filtered
                    </div>
                  );
                })()}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <ActionChip action={rule.action} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--label-1)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rule.phrase}
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--label-3)' }}>
                    <input type="checkbox" checked={rule.enabled} onChange={(e) => toggleRule(rule.id, e.target.checked)} />
                    On
                  </label>
                </div>
                <div style={{ fontSize: 11, color: 'var(--label-3)', marginBottom: 6 }}>
                  {rule.contexts.join(', ')} · {rule.wholeWord ? 'whole-word' : 'substring'} · {rule.semantic ? `semantic ${rule.semanticThreshold.toFixed(2)}` : 'semantic off'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--label-4)' }}>
                    {rule.expiresAt ? `Expires ${new Date(rule.expiresAt).toLocaleString()}` : 'No expiry'}
                  </span>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <button type="button" onClick={() => duplicateRule(rule.id)} disabled={Boolean(editingId)} style={{ border: 'none', background: 'transparent', color: Boolean(editingId) ? 'var(--label-4)' : 'var(--label-3)', fontSize: 11, fontWeight: 700, cursor: Boolean(editingId) ? 'default' : 'pointer', padding: 0 }}>
                      Duplicate
                    </button>
                    <button type="button" onClick={() => beginEdit(rule.id)} style={{ border: 'none', background: 'transparent', color: 'var(--blue)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                      Edit
                    </button>
                    <button type="button" onClick={() => confirmDeleteRule(rule.id)} style={{ border: 'none', background: 'transparent', color: 'var(--red)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                      Delete
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
