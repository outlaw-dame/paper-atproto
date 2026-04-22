type Lane = 'events' | 'state' | 'presence';

type AiSessionTelemetry = {
  routeErrors: number;
  productionRedactedErrors: number;
  droppedInvalidDurablePayloads: {
    events: number;
    state: number;
    presence: number;
  };
  dedupEvictions: number;
  metadataSanitizationMutations: number;
  durableFailOpenFallbacks: {
    events: number;
    state: number;
    presence: number;
  };
  durableStrictWriteFailures: {
    events: number;
    state: number;
    presence: number;
  };
  durableStrictReadFailures: {
    events: number;
    state: number;
    presence: number;
  };
  durableHydration: {
    attempts: number;
    successes: number;
    misses: number;
    failures: number;
    totalDurationMs: number;
    maxDurationMs: number;
    lastDurationMs: number;
    replayedItems: {
      events: number;
      state: number;
      presence: number;
    };
    replayedPages: {
      events: number;
      state: number;
      presence: number;
    };
  };
  durableHydrationDerived: {
    successRate: number;
    missRate: number;
    failureRate: number;
    averageSuccessDurationMs: number;
    replayedItemsPerSuccess: {
      events: number;
      state: number;
      presence: number;
    };
    replayedPagesPerSuccess: {
      events: number;
      state: number;
      presence: number;
    };
    replayedItemsPerPage: {
      events: number;
      state: number;
      presence: number;
    };
  };
};

const telemetry: AiSessionTelemetry = {
  routeErrors: 0,
  productionRedactedErrors: 0,
  droppedInvalidDurablePayloads: {
    events: 0,
    state: 0,
    presence: 0,
  },
  dedupEvictions: 0,
  metadataSanitizationMutations: 0,
  durableFailOpenFallbacks: {
    events: 0,
    state: 0,
    presence: 0,
  },
  durableStrictWriteFailures: {
    events: 0,
    state: 0,
    presence: 0,
  },
  durableStrictReadFailures: {
    events: 0,
    state: 0,
    presence: 0,
  },
  durableHydration: {
    attempts: 0,
    successes: 0,
    misses: 0,
    failures: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    lastDurationMs: 0,
    replayedItems: {
      events: 0,
      state: 0,
      presence: 0,
    },
    replayedPages: {
      events: 0,
      state: 0,
      presence: 0,
    },
  },
  durableHydrationDerived: {
    successRate: 0,
    missRate: 0,
    failureRate: 0,
    averageSuccessDurationMs: 0,
    replayedItemsPerSuccess: {
      events: 0,
      state: 0,
      presence: 0,
    },
    replayedPagesPerSuccess: {
      events: 0,
      state: 0,
      presence: 0,
    },
    replayedItemsPerPage: {
      events: 0,
      state: 0,
      presence: 0,
    },
  },
};

export function recordRouteError(): void {
  telemetry.routeErrors += 1;
}

export function recordProductionRedactedError(): void {
  telemetry.productionRedactedErrors += 1;
}

export function recordDroppedInvalidDurablePayload(lane: Lane): void {
  telemetry.droppedInvalidDurablePayloads[lane] += 1;
}

export function recordDedupEviction(): void {
  telemetry.dedupEvictions += 1;
}

export function recordMetadataSanitizationMutation(): void {
  telemetry.metadataSanitizationMutations += 1;
}

export function recordDurableFailOpenFallback(lane: Lane): void {
  telemetry.durableFailOpenFallbacks[lane] += 1;
}

export function recordDurableStrictWriteFailure(lane: Lane): void {
  telemetry.durableStrictWriteFailures[lane] += 1;
}

export function recordDurableStrictReadFailure(lane: Lane): void {
  telemetry.durableStrictReadFailures[lane] += 1;
}

export function recordDurableHydrationAttempt(): void {
  telemetry.durableHydration.attempts += 1;
}

export function recordDurableHydrationSuccess(input: {
  durationMs: number;
  replayedItems: { events: number; state: number; presence: number };
  replayedPages: { events: number; state: number; presence: number };
}): void {
  telemetry.durableHydration.successes += 1;
  telemetry.durableHydration.totalDurationMs += Math.max(0, Math.floor(input.durationMs));
  telemetry.durableHydration.lastDurationMs = Math.max(0, Math.floor(input.durationMs));
  telemetry.durableHydration.maxDurationMs = Math.max(
    telemetry.durableHydration.maxDurationMs,
    telemetry.durableHydration.lastDurationMs,
  );
  telemetry.durableHydration.replayedItems.events += Math.max(0, Math.floor(input.replayedItems.events));
  telemetry.durableHydration.replayedItems.state += Math.max(0, Math.floor(input.replayedItems.state));
  telemetry.durableHydration.replayedItems.presence += Math.max(0, Math.floor(input.replayedItems.presence));
  telemetry.durableHydration.replayedPages.events += Math.max(0, Math.floor(input.replayedPages.events));
  telemetry.durableHydration.replayedPages.state += Math.max(0, Math.floor(input.replayedPages.state));
  telemetry.durableHydration.replayedPages.presence += Math.max(0, Math.floor(input.replayedPages.presence));
}

export function recordDurableHydrationMiss(durationMs: number): void {
  telemetry.durableHydration.misses += 1;
  telemetry.durableHydration.lastDurationMs = Math.max(0, Math.floor(durationMs));
  telemetry.durableHydration.maxDurationMs = Math.max(
    telemetry.durableHydration.maxDurationMs,
    telemetry.durableHydration.lastDurationMs,
  );
}

export function recordDurableHydrationFailure(durationMs: number): void {
  telemetry.durableHydration.failures += 1;
  telemetry.durableHydration.lastDurationMs = Math.max(0, Math.floor(durationMs));
  telemetry.durableHydration.maxDurationMs = Math.max(
    telemetry.durableHydration.maxDurationMs,
    telemetry.durableHydration.lastDurationMs,
  );
}

export function getAiSessionTelemetry(): AiSessionTelemetry {
  const attempts = telemetry.durableHydration.attempts;
  const successes = telemetry.durableHydration.successes;
  const misses = telemetry.durableHydration.misses;
  const failures = telemetry.durableHydration.failures;
  const replayedItems = {
    events: telemetry.durableHydration.replayedItems.events,
    state: telemetry.durableHydration.replayedItems.state,
    presence: telemetry.durableHydration.replayedItems.presence,
  };
  const replayedPages = {
    events: telemetry.durableHydration.replayedPages.events,
    state: telemetry.durableHydration.replayedPages.state,
    presence: telemetry.durableHydration.replayedPages.presence,
  };

  const rate = (value: number, total: number): number => (total > 0 ? value / total : 0);
  const perSuccess = (value: number): number => (successes > 0 ? value / successes : 0);
  const perPage = (items: number, pages: number): number => (pages > 0 ? items / pages : 0);

  return {
    routeErrors: telemetry.routeErrors,
    productionRedactedErrors: telemetry.productionRedactedErrors,
    droppedInvalidDurablePayloads: {
      events: telemetry.droppedInvalidDurablePayloads.events,
      state: telemetry.droppedInvalidDurablePayloads.state,
      presence: telemetry.droppedInvalidDurablePayloads.presence,
    },
    dedupEvictions: telemetry.dedupEvictions,
    metadataSanitizationMutations: telemetry.metadataSanitizationMutations,
    durableFailOpenFallbacks: {
      events: telemetry.durableFailOpenFallbacks.events,
      state: telemetry.durableFailOpenFallbacks.state,
      presence: telemetry.durableFailOpenFallbacks.presence,
    },
    durableStrictWriteFailures: {
      events: telemetry.durableStrictWriteFailures.events,
      state: telemetry.durableStrictWriteFailures.state,
      presence: telemetry.durableStrictWriteFailures.presence,
    },
    durableStrictReadFailures: {
      events: telemetry.durableStrictReadFailures.events,
      state: telemetry.durableStrictReadFailures.state,
      presence: telemetry.durableStrictReadFailures.presence,
    },
    durableHydration: {
      attempts,
      successes,
      misses,
      failures,
      totalDurationMs: telemetry.durableHydration.totalDurationMs,
      maxDurationMs: telemetry.durableHydration.maxDurationMs,
      lastDurationMs: telemetry.durableHydration.lastDurationMs,
      replayedItems,
      replayedPages,
    },
    durableHydrationDerived: {
      successRate: rate(successes, attempts),
      missRate: rate(misses, attempts),
      failureRate: rate(failures, attempts),
      averageSuccessDurationMs: successes > 0
        ? telemetry.durableHydration.totalDurationMs / successes
        : 0,
      replayedItemsPerSuccess: {
        events: perSuccess(replayedItems.events),
        state: perSuccess(replayedItems.state),
        presence: perSuccess(replayedItems.presence),
      },
      replayedPagesPerSuccess: {
        events: perSuccess(replayedPages.events),
        state: perSuccess(replayedPages.state),
        presence: perSuccess(replayedPages.presence),
      },
      replayedItemsPerPage: {
        events: perPage(replayedItems.events, replayedPages.events),
        state: perPage(replayedItems.state, replayedPages.state),
        presence: perPage(replayedItems.presence, replayedPages.presence),
      },
    },
  };
}

export function resetAiSessionTelemetry(): void {
  telemetry.routeErrors = 0;
  telemetry.productionRedactedErrors = 0;
  telemetry.droppedInvalidDurablePayloads.events = 0;
  telemetry.droppedInvalidDurablePayloads.state = 0;
  telemetry.droppedInvalidDurablePayloads.presence = 0;
  telemetry.dedupEvictions = 0;
  telemetry.metadataSanitizationMutations = 0;
  telemetry.durableFailOpenFallbacks.events = 0;
  telemetry.durableFailOpenFallbacks.state = 0;
  telemetry.durableFailOpenFallbacks.presence = 0;
  telemetry.durableStrictWriteFailures.events = 0;
  telemetry.durableStrictWriteFailures.state = 0;
  telemetry.durableStrictWriteFailures.presence = 0;
  telemetry.durableStrictReadFailures.events = 0;
  telemetry.durableStrictReadFailures.state = 0;
  telemetry.durableStrictReadFailures.presence = 0;
  telemetry.durableHydration.attempts = 0;
  telemetry.durableHydration.successes = 0;
  telemetry.durableHydration.misses = 0;
  telemetry.durableHydration.failures = 0;
  telemetry.durableHydration.totalDurationMs = 0;
  telemetry.durableHydration.maxDurationMs = 0;
  telemetry.durableHydration.lastDurationMs = 0;
  telemetry.durableHydration.replayedItems.events = 0;
  telemetry.durableHydration.replayedItems.state = 0;
  telemetry.durableHydration.replayedItems.presence = 0;
  telemetry.durableHydration.replayedPages.events = 0;
  telemetry.durableHydration.replayedPages.state = 0;
  telemetry.durableHydration.replayedPages.presence = 0;
}
