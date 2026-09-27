import {
  sourceConfigSchema,
  type SourceConfig,
  type SourceCreate,
  type SourceDto,
  type SourceUpdate,
} from '@smart-rss/shared';
import type { Db } from '../db/client.js';

interface SourceRow {
  id: number;
  name: string;
  url: string;
  category_id: number | null;
  refresh_interval_minutes: number;
  enabled: number;
  config: string;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  paused_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface SourceRowWithCounts extends SourceRow {
  unread_count: number;
  total_count: number;
}

/** Internal view of a source used by the scheduler and pipeline. */
export interface SourceRecord {
  id: number;
  name: string;
  url: string;
  refreshIntervalMinutes: number;
  enabled: boolean;
  config: SourceConfig;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: string | null;
  consecutiveFailures: number;
  pausedReason: string | null;
}

/** Unread counts are per user (@userId; NULL counts everything as unread). */
const SELECT_WITH_COUNTS = `
  SELECT s.*,
    (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND i.purged = 0 AND NOT EXISTS
      (SELECT 1 FROM item_states st WHERE st.item_id = i.id AND st.user_id = @userId AND st.is_read = 1)) AS unread_count,
    (SELECT COUNT(*) FROM items i WHERE i.source_id = s.id AND i.purged = 0) AS total_count
  FROM sources s`;

const UPDATABLE_COLUMNS = {
  name: 'name',
  url: 'url',
  categoryId: 'category_id',
  refreshIntervalMinutes: 'refresh_interval_minutes',
  enabled: 'enabled',
  config: 'config',
} as const satisfies Record<keyof SourceUpdate, string>;

const parseConfig = (json: string): SourceConfig => sourceConfigSchema.parse(JSON.parse(json));

function toDto(row: SourceRowWithCounts): SourceDto {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    categoryId: row.category_id,
    refreshIntervalMinutes: row.refresh_interval_minutes,
    enabled: row.enabled === 1,
    config: parseConfig(row.config),
    health: {
      lastFetchedAt: row.last_fetched_at,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
      consecutiveFailures: row.consecutive_failures,
      pausedReason: row.paused_reason,
    },
    unreadCount: row.unread_count,
    totalCount: row.total_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRecord(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    refreshIntervalMinutes: row.refresh_interval_minutes,
    enabled: row.enabled === 1,
    config: parseConfig(row.config),
    etag: row.etag,
    lastModified: row.last_modified,
    lastFetchedAt: row.last_fetched_at,
    consecutiveFailures: row.consecutive_failures,
    pausedReason: row.paused_reason,
  };
}

function toColumnValue(key: keyof SourceUpdate, value: unknown): unknown {
  if (key === 'enabled') return value ? 1 : 0;
  if (key === 'config') return JSON.stringify(value);
  return value;
}

export function createSourcesRepository(db: Db) {
  type UserParam = { userId: number | null };
  const listStmt = db.prepare<[UserParam], SourceRowWithCounts>(`${SELECT_WITH_COUNTS} ORDER BY s.name COLLATE NOCASE`);
  const byIdStmt = db.prepare<[UserParam & { id: number }], SourceRowWithCounts>(`${SELECT_WITH_COUNTS} WHERE s.id = @id`);
  const byUrlStmt = db.prepare<[UserParam & { url: string }], SourceRowWithCounts>(
    `${SELECT_WITH_COUNTS} WHERE s.url = @url LIMIT 1`,
  );
  const rowByIdStmt = db.prepare<[number], SourceRow>('SELECT * FROM sources WHERE id = ?');
  const enabledStmt = db.prepare<[], SourceRow>('SELECT * FROM sources WHERE enabled = 1');
  const insertStmt = db.prepare(
    `INSERT INTO sources (name, url, category_id, refresh_interval_minutes, enabled, config)
     VALUES (@name, @url, @categoryId, @refreshIntervalMinutes, @enabled, @config)`,
  );
  const deleteStmt = db.prepare<[number]>('DELETE FROM sources WHERE id = ?');
  const successStmt = db.prepare(
    `UPDATE sources SET last_fetched_at = @at, last_success_at = @at, etag = @etag,
       last_modified = @lastModified, consecutive_failures = 0, last_error = NULL
     WHERE id = @id`,
  );
  const failureStmt = db.prepare(
    `UPDATE sources SET last_fetched_at = @at, last_error = @error,
       consecutive_failures = consecutive_failures + 1,
       paused_reason = CASE WHEN consecutive_failures + 1 >= @maxFailures
         THEN 'Paused after ' || (consecutive_failures + 1) || ' consecutive failures'
         ELSE paused_reason END
     WHERE id = @id`,
  );

  const getById = (id: number, userId: number | null = null): SourceDto | null => {
    const row = byIdStmt.get({ id, userId });
    return row ? toDto(row) : null;
  };

  return {
    /** userId selects whose unread counts are returned (null = everything unread). */
    list: (userId: number | null = null): SourceDto[] => listStmt.all({ userId }).map(toDto),
    getById,
    findByUrl(url: string): SourceDto | null {
      const row = byUrlStmt.get({ url, userId: null });
      return row ? toDto(row) : null;
    },
    getRecord(id: number): SourceRecord | null {
      const row = rowByIdStmt.get(id);
      return row ? toRecord(row) : null;
    },
    listEnabled: (): SourceRecord[] => enabledStmt.all().map(toRecord),

    create(input: SourceCreate): SourceDto {
      const { lastInsertRowid } = insertStmt.run({
        name: input.name,
        url: input.url,
        categoryId: input.categoryId,
        refreshIntervalMinutes: input.refreshIntervalMinutes,
        enabled: input.enabled ? 1 : 0,
        config: JSON.stringify(input.config),
      });
      return getById(Number(lastInsertRowid)) as SourceDto;
    },

    /** Applies a partial update. Any edit clears the failure/pause state and HTTP cache validators. */
    update(id: number, patch: SourceUpdate, now: string): SourceDto | null {
      const keys = (Object.keys(patch) as Array<keyof SourceUpdate>).filter(
        (key) => patch[key] !== undefined,
      );
      const assignments = keys.map((key) => `${UPDATABLE_COLUMNS[key]} = @${key}`);
      const values = Object.fromEntries(keys.map((key) => [key, toColumnValue(key, patch[key])]));
      db.prepare(
        `UPDATE sources SET ${[...assignments, 'updated_at = @now', 'etag = NULL', 'last_modified = NULL',
          'consecutive_failures = 0', 'paused_reason = NULL'].join(', ')} WHERE id = @id`,
      ).run({ ...values, now, id });
      return getById(id);
    },

    remove: (id: number): boolean => deleteStmt.run(id).changes > 0,

    recordSuccess(id: number, at: string, validators: { etag: string | null; lastModified: string | null }) {
      successStmt.run({ id, at, etag: validators.etag, lastModified: validators.lastModified });
    },

    recordFailure(id: number, at: string, error: string, maxFailures: number) {
      failureStmt.run({ id, at, error: error.slice(0, 2000), maxFailures });
    },
  };
}

export type SourcesRepository = ReturnType<typeof createSourcesRepository>;
