import type { RefreshOutcome } from '@smart-rss/shared';
import { errorMessage } from '../lib/result.js';
import type { Repositories } from '../repositories/index.js';
import type { SourceRecord } from '../repositories/sources.js';
import { runPipeline, type PipelineDeps, type PipelineResult } from '../pipeline/run.js';

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface RefreshDeps {
  repos: Repositories;
  pipeline: PipelineDeps;
  maxConsecutiveFailures: number;
  logger: Logger;
  now: () => Date;
}

export type RefreshSource = (sourceId: number) => Promise<RefreshOutcome>;

function persist(deps: RefreshDeps, source: SourceRecord, result: PipelineResult, at: string): RefreshOutcome {
  const { sources, items } = deps.repos;
  if (result.status === 'ok') {
    const newItems = items.upsertMany(source.id, result.items, at);
    sources.recordSuccess(source.id, at, result.validators);
    return { status: 'ok', newItems, error: null };
  }
  if (result.status === 'not_modified') {
    sources.recordSuccess(source.id, at, { etag: source.etag, lastModified: source.lastModified });
    return { status: 'not_modified', newItems: 0, error: null };
  }
  const error = result.error ?? 'Unknown error';
  sources.recordFailure(source.id, at, error, deps.maxConsecutiveFailures);
  return { status: 'error', newItems: 0, error };
}

/** Fetches one source, stores new items, updates its health and fetch log. Never throws. */
export function createRefresher(deps: RefreshDeps): RefreshSource {
  return async (sourceId) => {
    const source = deps.repos.sources.getRecord(sourceId);
    if (!source) return { status: 'error', newItems: 0, error: 'Source not found' };
    const startedAt = deps.now().toISOString();
    const started = performance.now();
    let outcome: RefreshOutcome;
    let httpStatus: number | null = null;
    try {
      const result = await runPipeline(
        {
          url: source.url,
          config: source.config,
          mode: 'scheduled',
          etag: source.etag,
          lastModified: source.lastModified,
          knownGuids: (guids) => deps.repos.items.existingGuids(source.id, guids),
        },
        deps.pipeline,
      );
      httpStatus = result.http.status;
      outcome = persist(deps, source, result, deps.now().toISOString());
    } catch (error) {
      deps.logger.error({ err: error, sourceId }, 'Unexpected refresh failure');
      outcome = { status: 'error', newItems: 0, error: `Unexpected error: ${errorMessage(error)}` };
      if (deps.repos.sources.getRecord(sourceId)) {
        deps.repos.sources.recordFailure(sourceId, deps.now().toISOString(), outcome.error ?? '', deps.maxConsecutiveFailures);
      }
    }
    const durationMs = Math.round(performance.now() - started);
    if (deps.repos.sources.getRecord(sourceId)) {
      deps.repos.fetchLog.record({ sourceId, startedAt, durationMs, httpStatus, ...outcome });
    }
    const log = outcome.status === 'error' ? deps.logger.warn.bind(deps.logger) : deps.logger.info.bind(deps.logger);
    log({ sourceId, status: outcome.status, newItems: outcome.newItems, ms: durationMs, error: outcome.error ?? undefined }, 'Source refreshed');
    return outcome;
  };
}
