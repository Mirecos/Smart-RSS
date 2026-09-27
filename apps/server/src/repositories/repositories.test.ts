import { sourceCreateSchema, type ParsedItem } from '@smart-rss/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../db/client.js';
import { createRepositories, type Repositories } from './index.js';
import { decodeCursor, encodeCursor, toFtsQuery } from './items.js';

const NOW = '2024-06-01T12:00:00.000Z';

function makeItem(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    guid: 'g1',
    title: 'Hello world',
    link: 'https://example.com/1',
    content: '<p>Body text</p>',
    summary: null,
    author: 'Ann',
    image: null,
    categories: ['news'],
    publishedAt: '2024-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSource(repos: Repositories, name = 'Blog', categoryId: number | null = null) {
  return repos.sources.create(
    sourceCreateSchema.parse({
      name,
      url: `https://example.com/${name}.xml`,
      categoryId,
      config: { parser: { type: 'xml' } },
    }),
  );
}

describe('repositories', () => {
  let db: Db;
  let repos: Repositories;
  let uid: number;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repos = createRepositories(db);
    uid = repos.users.create({ username: 'reader', passwordHash: 'x', role: 'user' }).id;
  });

  describe('migrations', () => {
    it('sets user_version to the latest migration', () => {
      expect(db.pragma('user_version', { simple: true })).toBe(2);
    });
  });

  describe('categories', () => {
    it('creates, renames, ensures and removes categories', () => {
      const tech = repos.categories.create('Tech');

      expect(repos.categories.ensure('tech').id).toBe(tech.id);
      expect(repos.categories.rename(tech.id, 'Technology')?.name).toBe('Technology');
      expect(repos.categories.list().map((c) => c.name)).toEqual(['Technology']);
      expect(repos.categories.remove(tech.id)).toBe(true);
      expect(repos.categories.getById(tech.id)).toBeNull();
    });

    it('counts unread items of sources in the category', () => {
      const cat = repos.categories.create('News');
      const source = makeSource(repos, 'a', cat.id);
      repos.items.upsertMany(source.id, [makeItem(), makeItem({ guid: 'g2' })], NOW);

      expect(repos.categories.getById(cat.id)?.unreadCount).toBe(2);
    });

    it('detaches sources when a category is deleted', () => {
      const cat = repos.categories.create('Temp');
      const source = makeSource(repos, 'a', cat.id);

      repos.categories.remove(cat.id);

      expect(repos.sources.getById(source.id)?.categoryId).toBeNull();
    });
  });

  describe('sources', () => {
    it('round-trips config and exposes health defaults', () => {
      const source = makeSource(repos);

      expect(source.config.parser.type).toBe('xml');
      expect(source.enabled).toBe(true);
      expect(source.health).toEqual({
        lastFetchedAt: null,
        lastSuccessAt: null,
        lastError: null,
        consecutiveFailures: 0,
        pausedReason: null,
      });
      expect(repos.sources.findByUrl(source.url)?.id).toBe(source.id);
    });

    it('pauses a source after too many consecutive failures and resumes on edit', () => {
      const source = makeSource(repos);

      repos.sources.recordFailure(source.id, NOW, 'HTTP 500', 2);
      expect(repos.sources.getById(source.id)?.health.pausedReason).toBeNull();
      repos.sources.recordFailure(source.id, NOW, 'HTTP 500', 2);
      const paused = repos.sources.getById(source.id);
      expect(paused?.health.consecutiveFailures).toBe(2);
      expect(paused?.health.pausedReason).toMatch(/Paused after 2/);

      const edited = repos.sources.update(source.id, { name: 'Renamed' }, NOW);
      expect(edited?.name).toBe('Renamed');
      expect(edited?.health.pausedReason).toBeNull();
      expect(edited?.health.consecutiveFailures).toBe(0);
    });

    it('records success with cache validators', () => {
      const source = makeSource(repos);
      repos.sources.recordFailure(source.id, NOW, 'boom', 10);

      repos.sources.recordSuccess(source.id, NOW, { etag: '"abc"', lastModified: null });

      const record = repos.sources.getRecord(source.id);
      expect(record?.etag).toBe('"abc"');
      expect(record?.consecutiveFailures).toBe(0);
      expect(repos.sources.getById(source.id)?.health.lastError).toBeNull();
    });

    it('lists only enabled sources for the scheduler', () => {
      const a = makeSource(repos, 'a');
      const b = makeSource(repos, 'b');
      repos.sources.update(b.id, { enabled: false }, NOW);

      expect(repos.sources.listEnabled().map((s) => s.id)).toEqual([a.id]);
    });

    it('cascades item deletion when a source is removed', () => {
      const source = makeSource(repos);
      repos.items.upsertMany(source.id, [makeItem()], NOW);

      expect(repos.sources.remove(source.id)).toBe(true);
      expect(repos.items.list({ userId: uid, limit: 10 }).items).toHaveLength(0);
    });
  });

  describe('items', () => {
    it('inserts new items, refreshes changed ones and keeps read state', () => {
      const source = makeSource(repos);
      expect(repos.items.upsertMany(source.id, [makeItem()], NOW)).toBe(1);
      const [stored] = repos.items.list({ userId: uid, limit: 10 }).items;
      repos.items.update(stored!.id, uid, { isRead: true });

      const created = repos.items.upsertMany(source.id, [makeItem({ title: 'Updated title' })], NOW);

      const [after] = repos.items.list({ userId: uid, limit: 10 }).items;
      expect(created).toBe(0);
      expect(after?.title).toBe('Updated title');
      expect(after?.isRead).toBe(true);
    });

    it('persists corrected dates and categories when other fields are unchanged', () => {
      const source = makeSource(repos);
      repos.items.upsertMany(source.id, [makeItem()], NOW);

      repos.items.upsertMany(source.id, [makeItem({ publishedAt: '2024-04-01T00:00:00.000Z', categories: ['fixed'] })], NOW);

      const [stored] = repos.items.list({ userId: uid, limit: 1 }).items;
      expect(stored).toMatchObject({ publishedAt: '2024-04-01T00:00:00.000Z', categories: ['fixed'] });
    });

    it('sorts by published date but never in the future', () => {
      const source = makeSource(repos);
      repos.items.upsertMany(
        source.id,
        [
          makeItem({ guid: 'old', publishedAt: '2020-01-01T00:00:00.000Z' }),
          makeItem({ guid: 'future', publishedAt: '2099-01-01T00:00:00.000Z' }),
          makeItem({ guid: 'undated', publishedAt: null }),
        ],
        NOW,
      );

      const guids = repos.items.list({ userId: uid, limit: 10 }).items.map((i) => i.guid);

      expect(guids.at(-1)).toBe('old');
    });

    it('paginates with a cursor', () => {
      const source = makeSource(repos);
      const items = Array.from({ length: 5 }, (_, n) =>
        makeItem({ guid: `g${n}`, publishedAt: `2024-01-0${n + 1}T00:00:00.000Z` }),
      );
      repos.items.upsertMany(source.id, items, NOW);

      const first = repos.items.list({ userId: uid, limit: 2 });
      const second = repos.items.list({ userId: uid, limit: 2, cursor: first.nextCursor });
      const third = repos.items.list({ userId: uid, limit: 2, cursor: second.nextCursor });

      expect(first.items.map((i) => i.guid)).toEqual(['g4', 'g3']);
      expect(second.items.map((i) => i.guid)).toEqual(['g2', 'g1']);
      expect(third.items.map((i) => i.guid)).toEqual(['g0']);
      expect(third.nextCursor).toBeNull();
    });

    it('filters by unread, starred, category and full-text search', () => {
      const cat = repos.categories.create('C');
      const a = makeSource(repos, 'a', cat.id);
      const b = makeSource(repos, 'b');
      repos.items.upsertMany(a.id, [makeItem({ guid: '1', title: 'Rust release notes' })], NOW);
      repos.items.upsertMany(b.id, [makeItem({ guid: '2', title: 'Gardening tips' })], NOW);
      const gardening = repos.items.list({ userId: uid, limit: 10, sourceId: b.id }).items[0]!;
      repos.items.update(gardening.id, uid, { isStarred: true, isRead: true });

      expect(repos.items.list({ userId: uid, limit: 10, categoryId: cat.id }).items).toHaveLength(1);
      expect(repos.items.list({ userId: uid, limit: 10, unread: true }).items.map((i) => i.guid)).toEqual(['1']);
      expect(repos.items.list({ userId: uid, limit: 10, starred: true }).items.map((i) => i.guid)).toEqual(['2']);
      expect(repos.items.list({ userId: uid, limit: 10, q: 'rus' }).items.map((i) => i.guid)).toEqual(['1']);
      expect(repos.items.list({ userId: uid, limit: 10, q: 'garden"ing' }).items).toHaveLength(0);
    });

    it('marks items read by scope', () => {
      const cat = repos.categories.create('C');
      const a = makeSource(repos, 'a', cat.id);
      const b = makeSource(repos, 'b');
      repos.items.upsertMany(a.id, [makeItem({ guid: '1' })], NOW);
      repos.items.upsertMany(b.id, [makeItem({ guid: '2' }), makeItem({ guid: '3' })], NOW);

      expect(repos.items.markRead({ categoryId: cat.id }, uid)).toBe(1);
      expect(repos.items.markRead({ sourceId: b.id }, uid)).toBe(2);
      expect(repos.items.markRead({}, uid)).toBe(0);
    });

    it('purges old read items but keeps a tombstone for dedupe', () => {
      const source = makeSource(repos);
      repos.items.upsertMany(source.id, [makeItem({ publishedAt: '2020-01-01T00:00:00.000Z' })], NOW);
      const [item] = repos.items.list({ userId: uid, limit: 1 }).items;
      repos.items.update(item!.id, uid, { isRead: true });

      expect(repos.items.purgeOlderThan('2021-01-01T00:00:00.000Z')).toBe(1);
      expect(repos.items.list({ userId: uid, limit: 10 }).items).toHaveLength(0);
      expect(repos.items.upsertMany(source.id, [makeItem({ publishedAt: '2020-01-01T00:00:00.000Z' })], NOW)).toBe(0);
      expect(repos.items.existingGuids(source.id, ['g1', 'nope'])).toEqual(new Set(['g1']));
    });
  });

  describe('settings and fetch log', () => {
    it('returns defaults and persists updates', () => {
      expect(repos.settings.get()).toEqual({ retentionDays: 30, defaultRefreshMinutes: 60 });
      expect(repos.settings.update({ retentionDays: 7 })).toEqual({ retentionDays: 7, defaultRefreshMinutes: 60 });
    });

    it('records and lists fetch log entries newest first', () => {
      const source = makeSource(repos);
      const entry = { sourceId: source.id, startedAt: NOW, durationMs: 5, httpStatus: 200, newItems: 1, error: null };
      repos.fetchLog.record({ ...entry, status: 'ok' });
      repos.fetchLog.record({ ...entry, status: 'error', error: 'x' });

      expect(repos.fetchLog.listForSource(source.id).map((e) => e.status)).toEqual(['error', 'ok']);
    });
  });
});

describe('cursor and fts helpers', () => {
  it('round-trips a cursor and rejects garbage', () => {
    const cursor = { sortAt: NOW, id: 42 };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor('not-a-cursor')).toBeNull();
  });

  it('builds a quoted prefix query', () => {
    expect(toFtsQuery('foo "bar')).toBe('"foo"* """bar"*');
    expect(toFtsQuery('   ')).toBeNull();
  });
});
