# Rate Limiting Runbook

This runbook explains how to operate the server rate limiter in either:

- in-memory mode (default)
- Redis-backed shared mode (optional)

## Overview

The server supports two limiter strategies for API middleware:

- fixed-window limiter
- token-bucket limiter

Both strategies use a pluggable backend.

- Default backend: in-memory maps (single-instance scope)
- Optional backend: Redis (shared across instances)

If Redis is configured but unavailable, the limiter fails over to in-memory for availability.

## Environment Variables

Set in `server/.env`:

```bash
# Enable shared/distributed limiter by setting a valid Redis URL.
# Leave unset to use in-memory limiter only.
RATE_LIMIT_REDIS_URL=redis://127.0.0.1:6379

# Optional Redis key namespace (default: paper:ratelimit)
RATE_LIMIT_REDIS_PREFIX=paper:ratelimit

# Optional strict mode. When true, requests fail with 503 if Redis limiter is unavailable.
RATE_LIMIT_REDIS_FAIL_CLOSED=false

# Do not trust proxy-forwarded client IP headers unless explicitly enabled.
RATE_LIMIT_TRUST_PROXY=false

# Header to read client IP from when RATE_LIMIT_TRUST_PROXY=true.
# Example values: cf-connecting-ip, x-forwarded-for
RATE_LIMIT_TRUSTED_IP_HEADER=cf-connecting-ip
```

Behavior:

- `RATE_LIMIT_REDIS_URL` unset: always in-memory backend
- `RATE_LIMIT_REDIS_URL` set and healthy: Redis backend used
- Redis runtime error: automatic fallback to in-memory backend
- `RATE_LIMIT_REDIS_FAIL_CLOSED=true`: Redis unavailability returns `503` instead of falling back

Production safety checks:

- In production, Redis URLs must use `rediss://`.
- In production, Redis URLs must include a password.
- If these checks fail, Redis backend is disabled.

## Safe Defaults

- In-memory maps are pruned and bounded to reduce unbounded growth risk.
- Redis fallback uses a short cooldown window before retrying Redis backend use.
- Redis scripts compute `retryAfterMs` atomically for both limiter types.

## Failover Expectations

If Redis is down or intermittently failing:

- Requests are still rate-limited using in-memory state.
- Limiting remains functional but no longer globally shared across instances.
- Existing in-memory bounds/pruning still apply.

This is an availability-first fallback, not a strict global consistency mode.

If `RATE_LIMIT_REDIS_FAIL_CLOSED=true`:

- Requests fail with `503` while Redis backend is unavailable.
- No in-memory fallback is used.

## Validation Checklist

1. Start Redis locally:

```bash
docker run --rm -p 6379:6379 redis:7
```

2. Start server with Redis vars:

```bash
cd server
RATE_LIMIT_REDIS_URL=redis://127.0.0.1:6379 npm run dev
```

3. Trigger repeated calls to a rate-limited endpoint and confirm `429` with retry metadata.

4. Stop Redis and continue requests.

Expected:

- Service remains responsive.
- Rate limiting still active (fallback backend).
- Behavior becomes instance-local until Redis returns.

## Operational Notes

- Use Redis-backed mode in multi-instance or autoscaled deployments.
- In-memory mode is acceptable for local/dev or single-instance operation.
- Keep the Redis key prefix unique per environment (dev/staging/prod) to avoid collisions.
- Enable `RATE_LIMIT_TRUST_PROXY=true` only when your edge proxy strips/sets the trusted header.
- For production Redis, prefer ACL user credentials over broad default-user access.
