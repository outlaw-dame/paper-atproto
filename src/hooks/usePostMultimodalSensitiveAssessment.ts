import { useEffect, useState } from 'react';
import {
  EMPTY_SENSITIVE_MEDIA_ASSESSMENT,
  assessmentFromMediaAnalysis,
  createUnavailableSensitiveMediaAssessment,
  type SensitiveMediaAssessment,
} from '../lib/moderation/sensitiveMedia';
import { callMediaAnalyzer } from '../intelligence/modelClient';

const multimodalSensitiveCache = new Map<string, SensitiveMediaAssessment>();
// Dedup in-flight analyzer calls so multiple cards for the same media URL
// share one network call and one moderation result.
const multimodalInFlight = new Map<string, Promise<unknown>>();
// Per-media cooldown after hard failures to avoid retry storms.
const multimodalCooldownUntil = new Map<string, number>();

const MULTIMODAL_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const MULTIMODAL_RETRY_BASE_MS = 5_000;
const MULTIMODAL_RETRY_MAX_MS = 60_000;
const MULTIMODAL_RETRY_ATTEMPTS = 3;

function multimodalRetryDelayMs(attempt: number): number {
  const exponential = Math.min(
    MULTIMODAL_RETRY_MAX_MS,
    MULTIMODAL_RETRY_BASE_MS * (2 ** attempt),
  );
  // Add bounded jitter so many clients don't synchronize retries.
  const jitterFactor = 0.8 + (Math.random() * 0.4);
  return Math.round(exponential * jitterFactor);
}

export interface MultimodalVisualTarget {
  readonly url: string;
  readonly alt: string;
  readonly cacheKey: string;
}

interface UsePostMultimodalSensitiveAssessmentArgs {
  readonly postId: string;
  readonly postContent: string;
  readonly target: MultimodalVisualTarget | null;
}

export function usePostMultimodalSensitiveAssessment({
  postId,
  postContent,
  target,
}: UsePostMultimodalSensitiveAssessmentArgs): SensitiveMediaAssessment {
  const [assessment, setAssessment] = useState<SensitiveMediaAssessment>(EMPTY_SENSITIVE_MEDIA_ASSESSMENT);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    setAssessment(EMPTY_SENSITIVE_MEDIA_ASSESSMENT);
    setRetryAttempt(0);
  }, [postId]);

  useEffect(() => {
    if (!target) return;

    const cached = multimodalSensitiveCache.get(target.cacheKey);
    if (cached) {
      setAssessment(cached);
      return;
    }

    const cooldownUntil = multimodalCooldownUntil.get(target.cacheKey) ?? 0;
    if (cooldownUntil > Date.now()) {
      setAssessment(createUnavailableSensitiveMediaAssessment());
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = () => {
      if (cancelled) return;
      if (retryAttempt >= MULTIMODAL_RETRY_ATTEMPTS) {
        multimodalCooldownUntil.set(target.cacheKey, Date.now() + MULTIMODAL_RATE_LIMIT_COOLDOWN_MS);
        return;
      }
      retryTimer = setTimeout(() => {
        if (!cancelled) {
          setRetryAttempt((current) => current + 1);
        }
      }, multimodalRetryDelayMs(retryAttempt));
    };

    (async () => {
      try {
        const cacheKey = target.cacheKey;
        let pending = multimodalInFlight.get(cacheKey) as
          | Promise<Awaited<ReturnType<typeof callMediaAnalyzer>>>
          | undefined;

        if (!pending) {
          pending = callMediaAnalyzer({
            threadId: postId,
            mediaUrl: target.url,
            ...(target.alt ? { mediaAlt: target.alt } : {}),
            nearbyText: postContent,
            candidateEntities: [],
            factualHints: [],
          });
          multimodalInFlight.set(cacheKey, pending);
          void pending.finally(() => {
            if (multimodalInFlight.get(cacheKey) === pending) {
              multimodalInFlight.delete(cacheKey);
            }
          }).catch(() => {});
        }

        const result = await pending;
        const nextAssessment = assessmentFromMediaAnalysis(result);
        const authoritative = result.analysisStatus !== 'degraded'
          && result.moderationStatus !== 'unavailable';

        if (authoritative) {
          multimodalSensitiveCache.set(target.cacheKey, nextAssessment);
        } else {
          scheduleRetry();
        }

        if (!cancelled) {
          setAssessment(nextAssessment);
        }
      } catch (err) {
        const status = (err as { status?: number } | undefined)?.status;
        if (status === 429 || status === 503) {
          multimodalCooldownUntil.set(target.cacheKey, Date.now() + MULTIMODAL_RATE_LIMIT_COOLDOWN_MS);
          if (!cancelled) {
            setAssessment(createUnavailableSensitiveMediaAssessment());
          }
          return;
        }

        if (!cancelled) {
          setAssessment(createUnavailableSensitiveMediaAssessment());
        }
        scheduleRetry();
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [postContent, postId, retryAttempt, target]);

  return assessment;
}