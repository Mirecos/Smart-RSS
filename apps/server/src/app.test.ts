import type { FastifyInstance, InjectOptions } from 'fastify';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../test/fixture-server.js';
import { API_JSON, BLOG_HTML, RSS_FEED } from '../test/fixtures.js';
import { buildApp, type BuiltApp } from './app.js';
import { loadConfig } from './config.js';
import { ensureInitialAdmin } from './auth/bootstrap.js';
import { openDatabase } from './db/client.js';

let fixtures: FixtureServer;
let built: BuiltApp;
let app: FastifyInstance;

beforeAll(async () => {
  fixtures = await startFixtureServer({
    '/feed.xml': { body: RSS_FEED, headers: { 'content-type': 'application/rss+xml' } },
    '/blog': { body: BLOG_HTML, headers: { 'content-type': 'text/html' } },
    '/api.json': { body: API_JSON, headers: { 'content-type': 'application/json' } },
  });
});

afterAll(() => fixtures.close());

const ADMIN = { username: 'admin', password: 'admin-password-1' };
let adminCookie: string;

/** Logs in through the API and returns the Cookie header value for the session. */
async function login(username: string, password: string): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  const session = response.cookies.find((cookie) => cookie.name === 'srss_session');
  if (!session) throw new Error(`login failed (${response.statusCode}): ${response.body}`);
  return `srss_session=${session.value}`;
}

beforeEach(async () => {
  const config = loadConfig({ DATA_DIR: ':memory:', LOG_LEVEL: 'silent', RENDERER_URL: 'ws://127.0.0.1:1?token=t' });
  built = await buildApp({ config, db: openDatabase(':memory:'), logger: false });
  app = built.app;
  await ensureInitialAdmin(built.repos, ADMIN);
  adminCookie = await login(ADMIN.username, ADMIN.password);
});

afterEach(async () => {
  await built.scheduler.stop();
  await app.close();
});

/** Calls the API as the admin by default; pass `as: null` for an anonymous caller or another cookie. */
async function call(options: InjectOptions & { as?: string | null }) {
  const { as = adminCookie, ...rest } = options;
  const headers = { ...(rest.headers ?? {}), ...(as ? { cookie: as } : {}) };
  const response = await app.inject({ ...rest, headers });
  return { status: response.statusCode, body: response.json(), headers: response.headers };
}

const xmlSource = (overrides: object = {}) => ({
  name: 'Example',
  url: `${fixtures.url}/feed.xml`,
  config: { parser: { type: 'xml' } },
  ...overrides,
});

async function createSource(payload: object = xmlSource()) {
  const { body } = await call({ method: 'POST', url: '/api/sources', payload });
  await built.scheduler.stop(); // wait for the initial background refresh
  return body.data as { id: number };
}

describe('health & security', () => {
  it('reports health, renderer status and security headers', async () => {
    const { status, body, headers } = await call({ method: 'GET', url: '/api/health' });

    expect(status).toBe(200);
    expect(body.data).toEqual({ status: 'ok', version: '0.1.0', renderer: { configured: true, reachable: false } });
    expect(headers['content-security-policy']).toContain("script-src 'self'");
    expect(headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects cross-origin writes but allows same-origin and non-browser clients', async () => {
    const payload = { name: 'Tech' };

    const cross = await call({ method: 'POST', url: '/api/categories', payload, headers: { origin: 'https://evil.example.com' } });
    const invalid = await call({ method: 'POST', url: '/api/categories', payload, headers: { origin: 'not a url' } });
    const same = await call({ method: 'POST', url: '/api/categories', payload, headers: { origin: 'http://localhost:80', host: 'localhost:80' } });

    const sameSite = await call({ method: 'POST', url: '/api/categories', payload: { name: 'X' }, headers: { 'sec-fetch-site': 'same-site' } });
    const sameOrigin = await call({ method: 'POST', url: '/api/categories', payload: { name: 'Y' }, headers: { 'sec-fetch-site': 'same-origin' } });
    expect(sameSite.status).toBe(403);
    expect(sameOrigin.status).toBe(201);
    expect(cross.status).toBe(403);
    expect(invalid.status).toBe(403);
    expect(same.status).toBe(201);
  });

  it('returns JSON 404s for unknown API routes and bad JSON as 400', async () => {
    const missing = await call({ method: 'GET', url: '/api/nope' });
    const badJson = await call({ method: 'POST', url: '/api/categories', payload: '{bad', headers: { 'content-type': 'application/json' } });

    expect(missing).toMatchObject({ status: 404, body: { success: false, error: { message: 'Route not found' } } });
    expect(badJson.status).toBe(400);
  });
});

describe('categories', () => {
  it('supports CRUD with conflict detection', async () => {
    const created = await call({ method: 'POST', url: '/api/categories', payload: { name: 'Tech' } });
    const id = created.body.data.id;

    expect((await call({ method: 'POST', url: '/api/categories', payload: { name: 'tech' } })).status).toBe(409);
    expect((await call({ method: 'PATCH', url: `/api/categories/${id}`, payload: { name: 'Science' } })).body.data.name).toBe('Science');
    expect((await call({ method: 'GET', url: '/api/categories' })).body.data).toHaveLength(1);
    expect((await call({ method: 'DELETE', url: `/api/categories/${id}` })).status).toBe(200);
    expect((await call({ method: 'DELETE', url: `/api/categories/${id}` })).status).toBe(404);
    expect((await call({ method: 'PATCH', url: `/api/categories/${id}`, payload: { name: 'X' } })).status).toBe(404);
  });
});

describe('sources', () => {
  it('validates input', async () => {
    const invalid = await call({ method: 'POST', url: '/api/sources', payload: { name: '', url: 'ftp://x', config: {} } });
    const badCategory = await call({ method: 'POST', url: '/api/sources', payload: xmlSource({ categoryId: 99 }) });

    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['name', 'url']));
    expect(badCategory).toMatchObject({ status: 400, body: { error: { message: 'Category 99 does not exist' } } });
  });

  it('creates a source, fetches it in the background and exposes details', async () => {
    const source = await createSource();

    const detail = await call({ method: 'GET', url: `/api/sources/${source.id}` });

    expect(detail.body.data).toMatchObject({ name: 'Example', totalCount: 2, unreadCount: 2 });
    expect(detail.body.data.fetchLog[0]).toMatchObject({ status: 'ok', newItems: 2 });
    expect((await call({ method: 'GET', url: '/api/sources' })).body.data).toHaveLength(1);
  });

  it('adds the starter sources on demand', async () => {
    // Don't hit the real internet from tests: the route only needs to trigger a scheduler tick.
    const tick = vi.spyOn(built.scheduler, 'tick').mockReturnValue(0);

    const first = await call({ method: 'POST', url: '/api/sources/starter' });
    const again = await call({ method: 'POST', url: '/api/sources/starter' });

    expect(first.body.data.created).toBeGreaterThan(0);
    expect(again.body.data).toMatchObject({ created: 0, skipped: first.body.data.created });
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('updates, refreshes and deletes a source', async () => {
    const source = await createSource();

    const patched = await call({ method: 'PATCH', url: `/api/sources/${source.id}`, payload: { name: 'Renamed', refreshIntervalMinutes: 15 } });
    const refreshed = await call({ method: 'POST', url: `/api/sources/${source.id}/refresh` });
    const removed = await call({ method: 'DELETE', url: `/api/sources/${source.id}` });

    expect(patched.body.data).toMatchObject({ name: 'Renamed', refreshIntervalMinutes: 15 });
    expect(refreshed.body.data).toEqual({ status: 'ok', newItems: 0, error: null });
    expect(removed.status).toBe(200);
    expect((await call({ method: 'GET', url: `/api/sources/${source.id}` })).status).toBe(404);
    expect((await call({ method: 'PATCH', url: `/api/sources/${source.id}`, payload: { name: 'x' } })).status).toBe(404);
    expect((await call({ method: 'POST', url: `/api/sources/${source.id}/refresh` })).status).toBe(404);
    expect((await call({ method: 'DELETE', url: `/api/sources/${source.id}` })).status).toBe(404);
    expect((await call({ method: 'GET', url: '/api/sources/abc' })).status).toBe(400);
  });
});

describe('items', () => {
  it('lists with pagination, updates flags and marks read', async () => {
    const source = await createSource();

    const firstPage = await call({ method: 'GET', url: '/api/items?limit=1' });
    const cursor = firstPage.body.meta.nextCursor as string;
    const secondPage = await call({ method: 'GET', url: `/api/items?limit=1&cursor=${cursor}` });
    const itemId = firstPage.body.data[0].id;
    const starred = await call({ method: 'PATCH', url: `/api/items/${itemId}`, payload: { isStarred: true } });
    const marked = await call({ method: 'POST', url: '/api/items/mark-read', payload: { sourceId: source.id } });
    const unread = await call({ method: 'GET', url: '/api/items?unread=true' });
    const search = await call({ method: 'GET', url: '/api/items?q=foremost' });

    expect(firstPage.body.data).toHaveLength(1);
    expect(secondPage.body.data[0].id).not.toBe(itemId);
    expect(secondPage.body.meta.nextCursor).toBeNull();
    expect(starred.body.data.isStarred).toBe(true);
    expect(marked.body.data).toEqual({ updated: 2 });
    expect(unread.body.data).toHaveLength(0);
    expect(search.body.data.map((i: { title: string }) => i.title)).toEqual(['First & foremost']);
  });

  it('rejects invalid queries, cursors and unknown items', async () => {
    expect((await call({ method: 'GET', url: '/api/items?limit=1000' })).status).toBe(400);
    expect((await call({ method: 'GET', url: '/api/items?cursor=garbage' })).status).toBe(400);
    expect((await call({ method: 'PATCH', url: '/api/items/999', payload: { isRead: true } })).status).toBe(404);
    expect((await call({ method: 'PATCH', url: '/api/items/1', payload: {} })).status).toBe(400);
  });
});

describe('preview', () => {
  it('previews an HTML scraper without storing anything', async () => {
    const payload = { url: `${fixtures.url}/blog`, config: { parser: { type: 'html', itemSelector: 'article.post' } } };

    const { body } = await call({ method: 'POST', url: '/api/preview', payload });

    expect(body.data.ok).toBe(true);
    expect(body.data.items.map((i: { title: string }) => i.title)).toEqual(['Post one', 'Post two']);
    expect(body.data.sample).toContain('article');
    expect((await call({ method: 'GET', url: '/api/items' })).body.data).toHaveLength(0);
  });

  it('returns pipeline errors as a failed preview', async () => {
    const payload = { url: `${fixtures.url}/api.json`, config: { parser: { type: 'json' } } };

    const { body } = await call({ method: 'POST', url: '/api/preview', payload });

    expect(body.data.ok).toBe(false);
    expect(body.data.diagnostics.at(-1).message).toMatch(/not a JSON Feed/);
  });

  it('returns the raw body or a 502 on fetch failure', async () => {
    const raw = await call({ method: 'POST', url: '/api/preview/raw', payload: { url: `${fixtures.url}/api.json` } });
    const failed = await call({ method: 'POST', url: '/api/preview/raw', payload: { url: `${fixtures.url}/missing` } });
    const rendered = await call({ method: 'POST', url: '/api/preview/raw', payload: { url: `${fixtures.url}/blog`, fetch: { render: true, timeoutMs: 1000 } } });

    expect(raw.body.data).toMatchObject({ truncated: false, http: { status: 200 } });
    expect(JSON.parse(raw.body.data.body)).toHaveProperty('data.posts');
    expect(failed.status).toBe(502);
    expect(rendered.status).toBe(502);
  });
});

describe('import / export', () => {
  it('round-trips OPML', async () => {
    const category = (await call({ method: 'POST', url: '/api/categories', payload: { name: 'News' } })).body.data;
    await createSource(xmlSource({ categoryId: category.id }));

    const exported = await app.inject({ method: 'GET', url: '/api/opml', headers: { cookie: adminCookie } });
    await call({ method: 'DELETE', url: '/api/sources/1' });
    const imported = await call({ method: 'POST', url: '/api/opml', payload: { content: exported.body } });
    const again = await call({ method: 'POST', url: '/api/opml', payload: { content: exported.body } });
    const invalid = await call({ method: 'POST', url: '/api/opml', payload: { content: '<nope' } });

    expect(exported.headers['content-type']).toContain('text/x-opml');
    expect(imported.body.data).toEqual({ created: 1, skipped: 0, errors: [] });
    expect(again.body.data).toEqual({ created: 0, skipped: 1, errors: [] });
    expect(invalid.status).toBe(400);
    expect((await call({ method: 'GET', url: '/api/sources' })).body.data[0].categoryId).toBe(category.id);
  });

  it('round-trips a full JSON backup including custom configs', async () => {
    const htmlConfig = { parser: { type: 'html', itemSelector: 'article.post' }, filters: [{ mode: 'exclude', pattern: 'ads' }] };
    await createSource(xmlSource({ name: 'Scraper', url: `${fixtures.url}/blog`, config: htmlConfig, enabled: false }));

    const exported = await call({ method: 'GET', url: '/api/export' });
    await call({ method: 'DELETE', url: '/api/sources/1' });
    const backup = { ...exported.body.data, sources: [...exported.body.data.sources, { ...exported.body.data.sources[0], url: 'javascript:alert(1)' }] };
    const imported = await call({ method: 'POST', url: '/api/import', payload: backup });
    const [restored] = (await call({ method: 'GET', url: '/api/sources' })).body.data;

    expect(exported.headers['content-disposition']).toContain('smart-rss-backup.json');
    expect(imported.body.data.created).toBe(1);
    expect(imported.body.data.errors[0]).toMatch(/invalid URL/);
    expect(restored).toMatchObject({ name: 'Scraper', enabled: false, config: { parser: { itemSelector: 'article.post' } } });
    expect((await call({ method: 'POST', url: '/api/import', payload: { version: 2 } })).status).toBe(400);
  });
});

describe('output feeds and settings', () => {
  it('serves aggregated feeds per scope and format', async () => {
    const source = await createSource();

    const rss = await app.inject({ method: 'GET', url: '/feeds/all.rss' });
    const atom = await app.inject({ method: 'GET', url: `/feeds/source-${source.id}.atom` });
    const json = await app.inject({ method: 'GET', url: '/feeds/all.json' });

    expect(rss.headers['content-type']).toContain('application/rss+xml');
    expect(rss.body).toContain('<![CDATA[First & foremost]]>');
    expect(atom.body).toContain('<feed');
    expect(JSON.parse(json.body).items).toHaveLength(2);
    // Starred items are personal since authentication: no public starred feed.
    expect((await app.inject({ method: 'GET', url: '/feeds/starred.json' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/feeds/category-9.rss' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/feeds/source-9.rss' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/feeds/all.txt' })).statusCode).toBe(404);
  });

  it('serves category feeds', async () => {
    const category = (await call({ method: 'POST', url: '/api/categories', payload: { name: 'News' } })).body.data;

    const response = await app.inject({ method: 'GET', url: `/feeds/category-${category.id}.json` });

    expect(JSON.parse(response.body).title).toBe('Smart RSS · News');
  });

  it('reads and updates settings', async () => {
    const updated = await call({ method: 'PATCH', url: '/api/settings', payload: { retentionDays: 7 } });
    const invalid = await call({ method: 'PATCH', url: '/api/settings', payload: { retentionDays: -1 } });

    expect(updated.body.data).toEqual({ retentionDays: 7, defaultRefreshMinutes: 60 });
    expect(invalid.status).toBe(400);
    expect((await call({ method: 'GET', url: '/api/settings' })).body.data.retentionDays).toBe(7);
  });
});

describe('static web app', () => {
  it('serves the SPA with history fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'smart-rss-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Smart RSS</title>');
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
    const config = loadConfig({ LOG_LEVEL: 'silent', WEB_DIST_DIR: dir });
    const web = await buildApp({ config, db: openDatabase(':memory:'), logger: false });

    const index = await web.app.inject({ method: 'GET', url: '/sources/new' });
    const asset = await web.app.inject({ method: 'GET', url: '/assets/app.js' });
    const anonymousApi = await web.app.inject({ method: 'GET', url: '/api/unknown' });

    expect(index.body).toContain('Smart RSS');
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(asset.headers['cache-control']).toContain('immutable');
    // The web app itself is public (it shows the login page); the API is not, not even for unknown routes.
    expect(anonymousApi.statusCode).toBe(401);
    await web.app.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('config', () => {
  it('parses environment variables and fails fast on invalid values', () => {
    const config = loadConfig({ PORT: '9000', SCHEDULER_ENABLED: 'false', ALLOWED_ORIGINS: 'http://a.test, http://b.test' });

    expect(config).toMatchObject({ port: 9000, host: '127.0.0.1', scheduler: { enabled: false }, allowedOrigins: ['http://a.test', 'http://b.test'] });
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid configuration: PORT/);
  });
});
