import React, { useMemo, useState } from 'react';
import { useContentFilterStore } from '../store/contentFilterStore.js';
import { useContentFilterMetricsStore } from '../store/contentFilterMetricsStore.js';
import { useSensitiveMediaStore } from '../store/sensitiveMediaStore.js';
import { useGetBlocks, useGetMutes } from '../lib/atproto/queries.js';
import type { KeywordFilterRule } from '../lib/contentFilters/types.js';

function isRuleActive(rule: KeywordFilterRule, now: number): boolean {
  if (!rule.enabled) return false;
  if (!rule.expiresAt) return true;
  const parsed = Date.parse(rule.expiresAt);
  return Number.isFinite(parsed) && parsed > now;
}

function formatPhraseLabel(phrase: string): string {
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

  const activeRules = useMemo(
    () => rules.filter((rule) => isRuleActive(rule, now)),
    [rules, now],
  );

  const blockedCount = blocksData?.data.blocks.length ?? 0;
  const mutedCount = mutesData?.data.mutes.length ?? 0;

  // Total filtered this session = sum of all per-rule counts
  const totalFiltered = useMemo(
    () => Object.values(filteredCountByRuleId).reduce((sum, n) => sum + n, 0),
    [filteredCountByRuleId],
  );

  // Top triggered rules — join counts back to rule phrases
  const topTriggeredRules = useMemo(() => {
    const ruleMap = new Map(rules.map((r) => [r.id, r]));
    return Object.entries(filteredCountByRuleId)
      .map(([ruleId, count]) => {
        const rule = ruleMap.get(ruleId);
        return rule ? { phrase: rule.phrase, action: rule.action, count } : null;
      })
      .filter((entry): entry is { phrase: string; action: string; count: number } => entry !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredCountByRuleId, rules]);

  const warnCount = activeRules.filter((r) => r.action === 'warn').length;
  const hideCount = activeRules.filter((r) => r.action === 'hide').length;
  const semanticCount = activeRules.filter((r) => r.semantic).length;

  const expiring7d = useMemo(() => {
    const weekAhead = now + 7 * 24 * 60 * 60 * 1000;
    return activeRules.filter((rule) => {
      if (!rule.expiresAt) return false;
      const at = Date.parse(rule.expiresAt);
      return Number.isFinite(at) && at > now && at <= weekAhead;
    }).length;
  }, [activeRules, now]);

  // Unused rules: active but triggered 0 times this session (and session has data)
  const unusedActiveRules = useMemo(() => {
    if (totalFiltered === 0) return 0;
    return activeRules.filter((rule) => !filteredCountByRuleId[rule.id]).length;
  }, [activeRules, filteredCountByRuleId, totalFiltered]);

  // Generate suggestions
  const suggestions = useMemo(() => {
    const list: string[] = [];
    if (unusedActiveRules > 0) {
      list.push(
        `${unusedActiveRules} active filter rule${unusedActiveRules === 1 ? '' : 's'} haven't matched any content this session. Consider reviewing or removing them to keep your list focused.`,
      );
    }
    if (hideCount === 0 && warnCount > 0 && totalFiltered > 10) {
      list.push(
        'All your filters are set to Warn. If high-frequency content is disruptive, consider switching top-matched rules to Hide.',
      );
    }
    if (semanticCount === 0 && activeRules.length > 0) {
      list.push(
        'None of your rules use semantic matching. Enabling it on key rules catches paraphrased content that exact keywords miss.',
      );
    }
    if (expiring7d > 0) {
      list.push(
        `${expiring7d} rule${expiring7d === 1 ? '' : 's'} expire within the next 7 days. Review them if you want to keep them active.`,
      );
    }
    if (blockedCount > 20) {
      list.push(
        `You have ${blockedCount} blocked accounts. Periodic reviews help keep the list relevant.`,
      );
    }
    if (mutedCount > 20) {
      list.push(
        `You have ${mutedCount} muted accounts. Some may have timed mutes approaching expiry.`,
      );
    }
    return list;
  }, [unusedActiveRules, hideCount, warnCount, totalFiltered, semanticCount, activeRules.length, expiring7d, blockedCount, mutedCount]);

  return (
    <div
      style={{
        border: '1px solid var(--sep)',
        borderRadius: 12,
        padding: '10px 12px',
        background: 'var(--fill-1)',
        marginBottom: 12,
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--label-1)', marginBottom: 2 }}>
          Your moderation report
        </p>
        <p style={{ fontSize: 10, color: 'var(--label-4)' }}>Generated {reportGeneratedAt}</p>
      </div>

      {/* Privacy note */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--sep)',
          borderRadius: 8,
          padding: '6px 9px',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1, marginTop: 1 }}>🔒</span>
        <p style={{ fontSize: 10, color: 'var(--label-3)', lineHeight: 1.45 }}>
          This report is computed entirely on your device. No filter activity, keyword data, or account lists are shared with anyone. Only you can see this.
        </p>
      </div>

      {/* Activity summary row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 6,
          marginBottom: 10,
        }}
      >
        <div style={{ border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }}>
          <p style={{ fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }}>Filtered this session</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }}>{totalFiltered}</p>
        </div>
        <div style={{ border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }}>
          <p style={{ fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }}>Blocked accounts</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }}>{blockedCount}</p>
        </div>
        <div style={{ border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }}>
          <p style={{ fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }}>Muted accounts</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }}>{mutedCount}</p>
        </div>
      </div>

      {/* Second stat row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 6,
          marginBottom: 10,
        }}
      >
        <div style={{ border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }}>
          <p style={{ fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }}>Active rules</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }}>{activeRules.length}</p>
        </div>
        <div style={{ border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }}>
          <p style={{ fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }}>Warn / Hide</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--label-1)', lineHeight: 1 }}>{warnCount} / {hideCount}</p>
        </div>
        <div style={{ border: '1px solid var(--sep)', borderRadius: 9, padding: '7px 8px', background: 'var(--surface)' }}>
          <p style={{ fontSize: 10, color: 'var(--label-4)', marginBottom: 2 }}>Blur sensitive</p>
          <p style={{ fontSize: 16, fontWeight: 700, color: policy.blurSensitiveMedia ? 'var(--label-1)' : 'var(--label-4)', lineHeight: 1 }}>
            {policy.blurSensitiveMedia ? 'On' : 'Off'}
          </p>
        </div>
      </div>

      {/* Top triggered keywords */}
      <div
        style={{
          border: '1px solid var(--sep)',
          borderRadius: 9,
          padding: '8px 10px',
          background: 'var(--surface)',
          marginBottom: 10,
        }}
      >
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-2)', marginBottom: 6 }}>
          Most active filters this session
        </p>
        {topTriggeredRules.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--label-4)' }}>
            No filter matches recorded yet. Matches accumulate as you browse.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topTriggeredRules.map((entry) => (
              <div
                key={entry.phrase}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--label-1)', fontWeight: 600 }}>
                  {formatPhraseLabel(entry.phrase)}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: entry.action === 'hide' ? 'var(--red)' : 'var(--orange)',
                    fontWeight: 700,
                  }}
                >
                  {entry.count} match{entry.count === 1 ? '' : 'es'} · {entry.action}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div
          style={{
            border: '1px solid var(--sep)',
            borderRadius: 9,
            padding: '8px 10px',
            background: 'var(--surface)',
            marginBottom: 10,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: showSuggestions ? 8 : 0,
            }}
          >
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--label-2)' }}>
              Suggestions ({suggestions.length})
            </p>
            <button
              type="button"
              onClick={() => setShowSuggestions((prev) => !prev)}
              style={{
                border: '1px solid var(--sep)',
                background: 'transparent',
                color: 'var(--label-3)',
                borderRadius: 7,
                padding: '3px 7px',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {showSuggestions ? 'Hide' : 'Show'}
            </button>
          </div>
          {showSuggestions && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {suggestions.map((text, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--label-4)', marginTop: 1, flexShrink: 0 }}>·</span>
                  <p style={{ fontSize: 11, color: 'var(--label-2)', lineHeight: 1.45 }}>{text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer privacy reinforcement */}
      <p style={{ fontSize: 10, color: 'var(--label-4)', lineHeight: 1.4, textAlign: 'center' }}>
        All data in this report stays on your device and is never transmitted.
      </p>
    </div>
  );
}
