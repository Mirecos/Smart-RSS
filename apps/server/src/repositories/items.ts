import type { ItemDto, ItemUpdate, ParsedItem } from '@smart-rss/shared';
import type { Db } from '../db/client.js';
import { sha1 } from '../lib/hash.js';

interface ItemRow {
  id: number;
  source_id: number;
  source_name: string;
  guid: string;
  title: string;
  link: string | null;
  content_html: string | null;
  summary: string | null;
  author: string | null;
  image_url: string | null;
  categories: string;
  published_at: string | null;
  fetched_at: string;
  sort_at: string;
  is_read: number;
  is_starred: number;
}

export interface Cursor {
  sortAt: string;
  id: number;
}

export interface ItemListQuery {
  /** Whose read/star state to return; null = no user (everything unread, e.g. public output feeds). */
  userId: number | null;
  sourceId?: number;
  categoryId?: number;
  unread?: boolean;
  starred?: boolean;
  q?: string;
  cursor?: Cursor | null;
  limit: number;
}

export interface ItemScope {
  sourceId?: number;
  categoryId?: number;
}

const GUID_CHUNK = 500;

/** The first placeholder is the user id whose read/star state is joined (NULL matches nobody). */
const SELECT_ITEM = `
  SELECT i.id, i.source_id, i.guid, i.title, i.link, i.content_html, i.summary, i.author, i.image_url,
    i.categories, i.published_at, i.fetched_at, i.sort_at, s.name AS source_name,
    COALESCE(st.is_read, 0) AS is_read, COALESCE(st.is_starred, 0) AS is_starred
  FROM items i
  JOIN sources s ON s.id = i.source_id
  LEFT JOIN item_states st ON st.item_id = i.id AND st.user_id = ?`;

function toDto(row: ItemRow): ItemDto {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    guid: row.guid,
    title: row.title,
    link: row.link,
    contentHtml: row.content_html,
    summary: row.summary,
    author: row.author,
    imageUrl: row.image_url,
    categories: JSON.parse(row.categories) as string[],
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    isRead: row.is_read === 1,
    isStarred: row.is_starred === 1,
  };
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.sortAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string): Cursor | null {
  const [sortAt, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const numericId = Number(id);
  if (!sortAt || !Number.isInteger(numericId) || Number.isNaN(Date.parse(sortAt))) return null;
  return { sortAt, id: numericId };
}

/** Turns free text into a safe FTS5 prefix query ("foo bar" → "foo"* "bar"*). */
export function toFtsQuery(text: string): string | null {
  const tokens = text.split(/\s+/).filter(Boolean).slice(0, 10);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' ');
}

function scopeClauses(scope: ItemScope): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (scope.sourceId !== undefined) {
    clauses.push('i.source_id = ?');
    params.push(scope.sourceId);
  }
  if (scope.categoryId !== undefined) {
    clauses.push('s.category_id = ?');
    params.push(scope.categoryId);
  }
  return { clauses, params };
}

function itemValues(sourceId: number, item: ParsedItem, fetchedAt: string) {
  const sortAt = item.publishedAt && item.publishedAt < fetchedAt ? item.publishedAt : fetchedAt;
  return {
    sourceId,
    guid: item.guid,
    title: item.title,
    link: item.link,
    content: item.content,
    summary: item.summary,
    author: item.author,
    image: item.image,
    categories: JSON.stringify(item.categories),
    publishedAt: item.publishedAt,
    fetchedAt,
    sortAt,
    hash: sha1(
      item.title, item.link, item.content, item.summary, item.author, item.image,
      item.publishedAt, JSON.stringify(item.categories),
    ),
  };
}

export function createItemsRepository(db: Db) {
  const insertStmt = db.prepare(
    `INSERT INTO items (source_id, guid, title, link, content_html, summary, author, image_url,
       categories, published_at, fetched_at, sort_at, content_hash)
     VALUES (@sourceId, @guid, @title, @link, @content, @summary, @author, @image,
       @categories, @publishedAt, @fetchedAt, @sortAt, @hash)
     ON CONFLICT (source_id, guid) DO NOTHING`,
  );
  const refreshStmt = db.prepare(
    `UPDATE items SET title = @title, link = @link, content_html = @content, summary = @summary,
       author = @author, image_url = @image, categories = @categories, published_at = @publishedAt,
       content_hash = @hash
     WHERE source_id = @sourceId AND guid = @guid AND content_hash <> @hash AND purged = 0`,
  );
  const byIdStmt = db.prepare<[number | null, number], ItemRow>(`${SELECT_ITEM} WHERE i.id = ?`);
  const purgeStmt = db.prepare<[string]>(
    `UPDATE items SET purged = 1, content_html = NULL, summary = NULL
     WHERE purged = 0 AND sort_at < ?
       AND id NOT IN (SELECT item_id FROM item_states WHERE is_starred = 1)`,
  );
  const stateStmt = db.prepare(
    `INSERT INTO item_states (user_id, item_id, is_read, is_starred)
     VALUES (@userId, @itemId, COALESCE(@isRead, 0), COALESCE(@isStarred, 0))
     ON CONFLICT (user_id, item_id) DO UPDATE SET
       is_read = COALESCE(@isRead, is_read), is_starred = COALESCE(@isStarred, is_starred)`,
  );
  const adoptStmt = db.prepare<[number]>(
    `INSERT INTO item_states (user_id, item_id, is_read, is_starred)
     SELECT ?, id, is_read, is_starred FROM items WHERE is_read = 1 OR is_starred = 1
     ON CONFLICT (user_id, item_id) DO NOTHING`,
  );

  const upsertTx = db.transaction((sourceId: number, items: ParsedItem[], fetchedAt: string) => {
    let created = 0;
    for (const item of items) {
      const values = itemValues(sourceId, item, fetchedAt);
      if (insertStmt.run(values).changes === 1) created++;
      else refreshStmt.run(values);
    }
    return created;
  });

  const getById = (id: number, userId: number | null): ItemDto | null => {
    const row = byIdStmt.get(userId, id);
    return row ? toDto(row) : null;
  };

  return {
    getById,

    /** Inserts new items and refreshes changed ones (read/star state is kept). Returns the number of new items. */
    upsertMany: (sourceId: number, items: ParsedItem[], fetchedAt: string): number =>
      upsertTx(sourceId, items, fetchedAt),

    existingGuids(sourceId: number, guids: string[]): Set<string> {
      const found = new Set<string>();
      for (let start = 0; start < guids.length; start += GUID_CHUNK) {
        const chunk = guids.slice(start, start + GUID_CHUNK);
        const rows = db
          .prepare<unknown[], { guid: string }>(
            `SELECT guid FROM items WHERE source_id = ? AND guid IN (${chunk.map(() => '?').join(',')})`,
          )
          .all(sourceId, ...chunk);
        for (const row of rows) found.add(row.guid);
      }
      return found;
    },

    list(query: ItemListQuery): { items: ItemDto[]; nextCursor: Cursor | null } {
      const { clauses, params } = scopeClauses(query);
      params.unshift(query.userId);
      clauses.push('i.purged = 0');
      if (query.unread) clauses.push('COALESCE(st.is_read, 0) = 0');
      if (query.starred) clauses.push('st.is_starred = 1');
      const fts = query.q ? toFtsQuery(query.q) : null;
      if (fts) {
        clauses.push('i.id IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)');
        params.push(fts);
      }
      if (query.cursor) {
        clauses.push('(i.sort_at, i.id) < (?, ?)');
        params.push(query.cursor.sortAt, query.cursor.id);
      }
      const rows = db
        .prepare<unknown[], ItemRow>(
          `${SELECT_ITEM} WHERE ${clauses.join(' AND ')} ORDER BY i.sort_at DESC, i.id DESC LIMIT ?`,
        )
        .all(...params, query.limit + 1);
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = rows.length > query.limit && last ? { sortAt: last.sort_at, id: last.id } : null;
      return { items: page.map(toDto), nextCursor };
    },

    /** Sets the user's own read/star flags on an item. */
    update(id: number, userId: number, patch: ItemUpdate): ItemDto | null {
      if (!getById(id, userId)) return null;
      const flag = (value: boolean | undefined) => (value === undefined ? null : value ? 1 : 0);
      stateStmt.run({ userId, itemId: id, isRead: flag(patch.isRead), isStarred: flag(patch.isStarred) });
      return getById(id, userId);
    },

    /** Marks every visible item in the scope as read for this user. Returns how many changed. */
    markRead(scope: ItemScope, userId: number): number {
      const clauses = [
        'i.purged = 0',
        'NOT EXISTS (SELECT 1 FROM item_states x WHERE x.user_id = @userId AND x.item_id = i.id AND x.is_read = 1)',
      ];
      if (scope.sourceId !== undefined) clauses.push('i.source_id = @sourceId');
      if (scope.categoryId !== undefined) {
        clauses.push('i.source_id IN (SELECT id FROM sources WHERE category_id = @categoryId)');
      }
      return db
        .prepare(
          `INSERT INTO item_states (user_id, item_id, is_read)
           SELECT @userId, i.id, 1 FROM items i WHERE ${clauses.join(' AND ')}
           ON CONFLICT (user_id, item_id) DO UPDATE SET is_read = 1`,
        )
        .run({ userId, sourceId: scope.sourceId ?? null, categoryId: scope.categoryId ?? null }).changes;
    },

    /** Hands the pre-authentication (single user) read/star state over to a user. */
    adoptLegacyState: (userId: number): number => adoptStmt.run(userId).changes,

    /** Drops the content of old items nobody starred (the row stays as a dedupe tombstone). */
    purgeOlderThan: (cutoffIso: string): number => purgeStmt.run(cutoffIso).changes,
  };
}

export type ItemsRepository = ReturnType<typeof createItemsRepository>;
