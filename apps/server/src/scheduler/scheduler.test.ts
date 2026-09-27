import { sourceCreateSchema, type RefreshOutcome } from '@smart-rss/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../../test/fixture-server.js';
import { RSS_FEED } from '../../test/fixtures.js';
import { openDatabase } from '../db/client.js';
import { createRepositories, type Repositories } from '../repositories/index.js';
import type { SourceRecord } from '../repositories/sources.js';
import { createRefresher, type Logger } from './refresh.js';
import { createScheduler, effectiveIntervalMinutes, isDue } from './scheduler.js';

const silentLogger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const NOW = new Date('2024-06-01T12:00:00.000Z');

const record = (overrides: Partial<SourceRecord> = {}): SourceRecord => ({
  id: 1,
  name: 's',
  url: 'https://a.example.com/feed',
  refreshIntervalMinutes: 60,
  enabled: true,
  config: sourceCreateSchema.shape.config.parse({ parser: { type: 'xml' } }),
  etag: null,
  lastModified: null,
  lastFetchedAt: null,
  consecutiveFailures: 0,
  pausedReason: null,
  ...overrides,
});

describe('scheduling rules', () => {
  it('backs off exponentially after failures, capped at a day', () => {
    expect(effectiveIntervalMinutes(30, 0)).toBe(30);
    expect(effectiveIntervalMinutes(30, 2)).toBe(120);
    expect(effectiveIntervalMinutes(60, 10)).toBe(1440);
    expect(effectiveIntervalMinutes(2880, 3)).toBe(2880);
  });

  it('decides when a source is due', () => {
    const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

    expect(isDue(record(), NOW)).toBe(true);
    expect(isDue(record({ lastFetchedAt: minutesAgo(59) }), NOW)).toBe(false);
    expect(isDue(record({ lastFetchedAt: minutesAgo(60) }), NOW)).toBe(true);
    expect(isDue(record({ lastFetchedAt: minutesAgo(90), consecutiveFailures: 1 }), NOW)).toBe(false);
    expect(isDue(record({ enabled: false }), NOW)).toBe(false);
    expect(isDue(record({ pausedReason: 'paused' }), NOW)).toBe(false);
  });
});

function addSource(repos: Repositories, url: string, name = url) {
  return repos.sources.create(sourceCreateSchema.parse({ name, url, config: { parser: { type: 'xml' } } }));
}

describe('scheduler', () => {
  let repos: Repositories;

  beforeEach(() => {
    repos = createRepositories(openDatabase(':memory:'));
  });

  it('refreshes due sources once and shares in-flight runs', async () => {
    const a = addSource(repos, 'https://a.example.com/1');
    addSource(repos, 'https://b.example.com/1');
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const refresh = vi.fn(async (): Promise<RefreshOutcome> => {
      await gate;
      return { status: 'ok', newItems: 0, error: null };
    });
    const scheduler = createScheduler({ repos, refresh, tickSeconds: 60, concurrency: 4, logger: silentLogger, now: () => NOW });

    expect(scheduler.tick()).toBe(2);
    expect(scheduler.tick()).toBe(0);
    const shared = scheduler.refreshNow(a.id);
    expect(scheduler.inFlightCount()).toBe(2);
    release();
    await expect(shared).resolves.toEqual({ status: 'ok', newItems: 0, error: null });
    await scheduler.stop();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('serializes sources that share a host', async () => {
    const first = addSource(repos, 'https://same.example.com/1');
    const second = addSource(repos, 'https://same.example.com/2');
    let active = 0;
    let maxActive = 0;
    const refresh = async (): Promise<RefreshOutcome> => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return { status: 'ok', newItems: 0, error: null };
    };
    const scheduler = createScheduler({ repos, refresh, tickSeconds: 60, concurrency: 4, logger: silentLogger, now: () => NOW });

    await Promise.all([scheduler.refreshNow(first.id), scheduler.refreshNow(second.id)]);

    expect(maxActive).toBe(1);
  });

  it('converts crashing refresh tasks into error outcomes', async () => {
    const source = addSource(repos, 'https://a.example.com/1');
    const logger = { ...silentLogger, error: vi.fn() };
    const scheduler = createScheduler({
      repos,
      refresh: () => Promise.reject(new Error('boom')),
      tickSeconds: 60,
      concurrency: 1,
      logger,
      now: () => NOW,
    });

    await expect(scheduler.refreshNow(source.id)).resolves.toMatchObject({ status: 'error' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('purges old read items during retention runs', () => {
    const source = addSource(repos, 'https://a.example.com/1');
    repos.items.upsertMany(
      source.id,
      [{ guid: 'old', title: 't', link: null, content: 'c', summary: null, author: null, image: null, categories: [], publishedAt: '2020-01-01T00:00:00.000Z' }],
      NOW.toISOString(),
    );
    repos.sources.update(source.id, { enabled: false }, NOW.toISOString());
    const logger = { ...silentLogger, info: vi.fn() };
    const scheduler = createScheduler({ repos, refresh: vi.fn(), tickSeconds: 60, concurrency: 1, logger, now: () => NOW });

    scheduler.tick();

    expect(repos.items.list({ userId: null, limit: 10 }).items).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ purged: 1 }), expect.any(String));
  });

  it('starts and stops the timer', async () => {
    const scheduler = createScheduler({ repos, refresh: vi.fn(), tickSeconds: 60, concurrency: 1, logger: silentLogger, now: () => NOW });

    scheduler.start();
    scheduler.start();
    await scheduler.stop();

    expect(scheduler.inFlightCount()).toBe(0);
  });
});

describe('refresher', () => {
  let server: FixtureServer;
  let repos: Repositories;

  beforeAll(async () => {
    server = await startFixtureServer({
      '/feed.xml': { body: RSS_FEED, headers: { etag: '"v1"' } },
      '/cached.xml': { handler: (req, res) => (req.headers['if-none-match'] === '"v1"' ? res.writeHead(304).end() : res.writeHead(200, { etag: '"v1"' }).end(RSS_FEED)) },
      '/broken': { status: 500 },
    });
  });

  afterAll(() => server.close());

  beforeEach(() => {
    repos = createRepositories(openDatabase(':memory:'));
  });

  const refresher = () =>
    createRefresher({
      repos,
      pipeline: { limits: { maxBytes: 1_000_000, maxRedirects: 2 }, rendererUrl: null },
      maxConsecutiveFailures: 2,
      logger: silentLogger,
      now: () => NOW,
    });

  it('stores new items, validators and a fetch log entry', async () => {
    const source = addSource(repos, `${server.url}/feed.xml`);

    const first = await refresher()(source.id);
    const second = await refresher()(source.id);

    expect(first).toEqual({ status: 'ok', newItems: 2, error: null });
    expect(second.newItems).toBe(0);
    expect(repos.sources.getRecord(source.id)?.etag).toBe('"v1"');
    expect(repos.fetchLog.listForSource(source.id)[0]).toMatchObject({ status: 'ok', httpStatus: 200 });
  });

  it('uses conditional requests and records not modified', async () => {
    const source = addSource(repos, `${server.url}/cached.xml`);
    await refresher()(source.id);

    const outcome = await refresher()(source.id);

    expect(outcome.status).toBe('not_modified');
    expect(repos.sources.getRecord(source.id)?.etag).toBe('"v1"');
  });

  it('records failures and pauses the source after the limit', async () => {
    const source = addSource(repos, `${server.url}/broken`);

    await refresher()(source.id);
    const outcome = await refresher()(source.id);

    expect(outcome).toMatchObject({ status: 'error', error: 'HTTP 500 Internal Server Error' });
    expect(repos.sources.getById(source.id)?.health.pausedReason).toMatch(/Paused after 2/);
  });

  it('handles unknown sources and unexpected exceptions', async () => {
    const source = addSource(repos, `${server.url}/feed.xml`);
    vi.spyOn(repos.items, 'upsertMany').mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    expect(await refresher()(9999)).toMatchObject({ status: 'error', error: 'Source not found' });
    expect(await refresher()(source.id)).toMatchObject({ status: 'error', error: 'Unexpected error: disk full' });
    expect(repos.sources.getById(source.id)?.health.consecutiveFailures).toBe(1);
  });
});
