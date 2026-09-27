const MAX_TRACKED_KEYS = 10_000;

export interface LoginLimiterOptions {
  maxFailures: number;
  windowMs: number;
  now?: () => number;
}

/** In-memory sliding-window counter of failed logins (single process, local app). */
export function createLoginLimiter({ maxFailures, windowMs, now = Date.now }: LoginLimiterOptions) {
  const failures = new Map<string, number[]>();

  const recent = (key: string): number[] => {
    const cutoff = now() - windowMs;
    const kept = (failures.get(key) ?? []).filter((time) => time > cutoff);
    if (kept.length === 0) failures.delete(key);
    else failures.set(key, kept);
    return kept;
  };

  return {
    isBlocked: (key: string): boolean => recent(key).length >= maxFailures,
    retryAfterSeconds(key: string): number {
      const oldest = recent(key)[0];
      return oldest === undefined ? 0 : Math.max(1, Math.ceil((oldest + windowMs - now()) / 1000));
    },
    recordFailure(key: string): void {
      if (failures.size >= MAX_TRACKED_KEYS && !failures.has(key)) {
        const firstKey = failures.keys().next().value;
        if (firstKey !== undefined) failures.delete(firstKey);
      }
      failures.set(key, [...recent(key), now()]);
    },
    reset(key: string): void {
      failures.delete(key);
    },
  };
}

export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
