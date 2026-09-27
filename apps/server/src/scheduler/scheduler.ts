import type { RefreshOutcome } from '@smart-rss/shared';
import pLimit, { type LimitFunction } from 'p-limit';
import type { Repositories } from '../repositories/index.js';
import type { SourceRecord } from '../repositories/sources.js';
import type { Logger, RefreshSource } from './refresh.js';

const MAX_BACKOFF_EXPONENT = 6;
const MAX_BACKOFF_MINUTES = 24 * 60;
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SchedulerDeps {
  repos: Repositories;
  refresh: RefreshSource;
  tickSeconds: number;
  concurrency: number;
  logger: Logger;
  now: () => Date;
}

/** Refresh interval with exponential backoff after failures (never shorter than the configured interval). */
export function effectiveIntervalMinutes(intervalMinutes: number, failures: number): number {
  if (failures === 0) return intervalMinutes;
  const backedOff = intervalMinutes * 2 ** Math.min(failures, MAX_BACKOFF_EXPONENT);
  return Math.max(intervalMinutes, Math.min(backedOff, MAX_BACKOFF_MINUTES));
}

export function isDue(source: SourceRecord, now: Date): boolean {
  if (!source.enabled || source.pausedReason) return false;
  if (!source.lastFetchedAt) return true;
  const interval = effectiveIntervalMinutes(source.refreshIntervalMinutes, source.consecutiveFailures);
  return now.getTime() - Date.parse(source.lastFetchedAt) >= interval * 60_000;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function createScheduler(deps: SchedulerDeps) {
  const globalLimit = pLimit(deps.concurrency);
  const hostLimits = new Map<string, LimitFunction>();
  const inFlight = new Map<number, Promise<RefreshOutcome>>();
  let timer: NodeJS.Timeout | null = null;
  let lastRetentionAt = 0;

  /** Refreshes a source now; concurrent calls for the same source share one run. */
  function refreshNow(sourceId: number): Promise<RefreshOutcome> {
    const existing = inFlight.get(sourceId);
    if (existing) return existing;
    const host = hostOf(deps.repos.sources.getRecord(sourceId)?.url ?? `source-${sourceId}`);
    const hostLimit = hostLimits.get(host) ?? pLimit(1);
    hostLimits.set(host, hostLimit);
    // Wait for the host slot first so queued same-host work never holds a global slot.
    const task = hostLimit(() => globalLimit(() => deps.refresh(sourceId)))
      .catch((error: unknown): RefreshOutcome => {
        deps.logger.error({ err: error, sourceId }, 'Refresh task crashed');
        return { status: 'error', newItems: 0, error: 'Refresh task crashed' };
      })
      .finally(() => {
        inFlight.delete(sourceId);
        if (hostLimit.activeCount === 0 && hostLimit.pendingCount === 0) hostLimits.delete(host);
      });
    inFlight.set(sourceId, task);
    return task;
  }

  function runRetention(now: Date): void {
    if (now.getTime() - lastRetentionAt < RETENTION_INTERVAL_MS) return;
    lastRetentionAt = now.getTime();
    const { retentionDays } = deps.repos.settings.get();
    if (retentionDays === 0) return;
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
    const purged = deps.repos.items.purgeOlderThan(cutoff);
    if (purged > 0) deps.logger.info({ purged, retentionDays }, 'Purged old read items');
  }

  /** Starts refreshes for every due source (without awaiting them) and runs retention when needed. */
  function tick(): number {
    const now = deps.now();
    const due = deps.repos.sources.listEnabled().filter((s) => isDue(s, now) && !inFlight.has(s.id));
    for (const source of due) void refreshNow(source.id);
    runRetention(now);
    return due.length;
  }

  const safeTick = () => {
    try {
      tick();
    } catch (error) {
      deps.logger.error({ err: error }, 'Scheduler tick failed');
    }
  };

  return {
    refreshNow,
    tick,
    start(): void {
      if (timer) return;
      safeTick();
      timer = setInterval(safeTick, deps.tickSeconds * 1000);
      timer.unref();
    },
    async stop(): Promise<void> {
      if (timer) clearInterval(timer);
      timer = null;
      await Promise.allSettled([...inFlight.values()]);
    },
    inFlightCount: () => inFlight.size,
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
