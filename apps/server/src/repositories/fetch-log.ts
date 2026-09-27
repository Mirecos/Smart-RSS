import type { FetchLogEntry } from '@smart-rss/shared';
import type { Db } from '../db/client.js';

const KEEP_PER_SOURCE = 50;

interface FetchLogRow {
  id: number;
  started_at: string;
  duration_ms: number;
  status: FetchLogEntry['status'];
  http_status: number | null;
  new_items: number;
  error: string | null;
}

export interface NewFetchLogEntry {
  sourceId: number;
  startedAt: string;
  durationMs: number;
  status: FetchLogEntry['status'];
  httpStatus: number | null;
  newItems: number;
  error: string | null;
}

export function createFetchLogRepository(db: Db) {
  const insertStmt = db.prepare(
    `INSERT INTO fetch_log (source_id, started_at, duration_ms, status, http_status, new_items, error)
     VALUES (@sourceId, @startedAt, @durationMs, @status, @httpStatus, @newItems, @error)`,
  );
  const pruneStmt = db.prepare<[number, number, number]>(
    `DELETE FROM fetch_log WHERE source_id = ? AND id NOT IN
       (SELECT id FROM fetch_log WHERE source_id = ? ORDER BY id DESC LIMIT ?)`,
  );
  const listStmt = db.prepare<[number, number], FetchLogRow>(
    'SELECT * FROM fetch_log WHERE source_id = ? ORDER BY id DESC LIMIT ?',
  );

  return {
    record(entry: NewFetchLogEntry): void {
      db.transaction(() => {
        insertStmt.run({ ...entry, error: entry.error?.slice(0, 2000) ?? null });
        pruneStmt.run(entry.sourceId, entry.sourceId, KEEP_PER_SOURCE);
      })();
    },
    listForSource: (sourceId: number, limit = 20): FetchLogEntry[] =>
      listStmt.all(sourceId, limit).map((row) => ({
        id: row.id,
        startedAt: row.started_at,
        durationMs: row.duration_ms,
        status: row.status,
        httpStatus: row.http_status,
        newItems: row.new_items,
        error: row.error,
      })),
  };
}

export type FetchLogRepository = ReturnType<typeof createFetchLogRepository>;
