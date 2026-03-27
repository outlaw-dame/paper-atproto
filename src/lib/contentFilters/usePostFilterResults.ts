import { useEffect, useMemo, useRef, useState } from 'react';
import type { MockPost } from '../../data/mockData.js';
import { useContentFilterStore } from '../../store/contentFilterStore.js';
import type { FilterContext, PostFilterMatch } from './types.js';
import { activeRulesForContext, getKeywordMatches, getSemanticMatches, searchableTextForPost } from './match.js';

type ResultByPostId = Record<string, PostFilterMatch[]>;

function resultMapEquals(a: ResultByPostId, b: ResultByPostId): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const aMatches = a[key] ?? [];
    const bMatches = b[key] ?? [];
    if (aMatches.length !== bMatches.length) return false;
    for (let i = 0; i < aMatches.length; i += 1) {
      const am = aMatches[i];
      const bm = bMatches[i];
      if (!am || !bm) return false;
      if (
        am.ruleId !== bm.ruleId ||
        am.phrase !== bm.phrase ||
        am.action !== bm.action ||
        am.matchType !== bm.matchType ||
        am.score !== bm.score
      ) {
        return false;
      }
    }
  }
  return true;
}

export function usePostFilterResults(posts: MockPost[], context: FilterContext) {
  const rules = useContentFilterStore((state) => state.rules);
  const [resultByPostId, setResultByPostId] = useState<ResultByPostId>({});
  const evalTokenRef = useRef(0);

  const activeRules = useMemo(() => activeRulesForContext(rules, context), [rules, context]);

  useEffect(() => {
    let isCancelled = false;
    evalTokenRef.current += 1;
    const token = evalTokenRef.current;

    if (activeRules.length === 0 || posts.length === 0) {
      setResultByPostId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }

    const run = async () => {
      const next: ResultByPostId = {};

      for (const post of posts) {
        const text = searchableTextForPost(post);
        // Keyword and semantic matches are independent — evaluate both
        const keywordMatches = getKeywordMatches(text, activeRules);
        const semanticMatches = await getSemanticMatches(text, activeRules);

        const merged = [...keywordMatches, ...semanticMatches];
        if (merged.length > 0) next[post.id] = merged;
      }

      if (!isCancelled && token === evalTokenRef.current) {
        setResultByPostId((prev) => (resultMapEquals(prev, next) ? prev : next));
      }
    };

    run().catch(() => {
      if (!isCancelled && token === evalTokenRef.current) {
        setResultByPostId((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [activeRules, posts]);

  return resultByPostId;
}
