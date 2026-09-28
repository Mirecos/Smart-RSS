import type { FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from './app.js';
import { ensureInitialAdmin } from './auth/bootstrap.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { cookiePath, injectBasePath, stripBasePath } from './lib/base-path.js';

const BUILT_INDEX = `<!doctype html><html><head><meta charset="UTF-8" />
<base href="/" />
<meta name="smart-rss-base" content="" />
<script type="module" src="./assets/app.js"></script></head><body></body></html>`;

describe('base path helpers', () => {
  it('strips the prefix and rejects URLs outside of it', () => {
    expect(stripBasePath('/smart-rss/api/items?x=1', '/smart-rss')).toBe('/api/items?x=1');
    expect(stripBasePath('/smart-rss', '/smart-rss')).toBe('/');
    expect(stripBasePath('/smart-rss?x', '/smart-rss')).toBe('/?x');
    expect(stripBasePath('/smart-rss-other/api', '/smart-rss')).toBeNull();
    expect(stripBasePath('/api/items', '/smart-rss')).toBeNull();
    expect(stripBasePath('/api/items', '')).toBe('/api/items');
  });

  it('injects the base path into the built index.html', () => {
    const html = injectBasePath(BUILT_INDEX, '/smart-rss');

    expect(html).toContain('<base href="/smart-rss/" />');
    expect(html).toContain('<meta name="smart-rss-base" content="/smart-rss" />');
    expect(injectBasePath(BUILT_INDEX, '')).toContain('<base href="/" />');
    expect(cookiePath('')).toBe('/');
    expect(cookiePath('/smart-rss')).toBe('/smart-rss');
  });

  it('validates and normalizes BASE_PATH', () => {
    expect(loadConfig({ BASE_PATH: '/smart-rss/' }).basePath).toBe('/smart-rss');
    expect(loadConfig({}).basePath).toBe('');
    expect(() => loadConfig({ BASE_PATH: 'smart-rss' })).toThrow(/BASE_PATH/);
    expect(() => loadConfig({ BASE_PATH: '/bad path' })).toThrow(/BASE_PATH/);
  });
});

describe('serving under /smart-rss', () => {
  let dir: string;
  let built: BuiltApp;
  let app: FastifyInstance;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'smart-rss-base-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), BUILT_INDEX);
    writeFileSync(join(dir, 'assets', 'app.js'), 'export {}');
    const config = loadConfig({ LOG_LEVEL: 'silent', WEB_DIST_DIR: dir, BASE_PATH: '/smart-rss', SCHEDULER_ENABLED: 'false' });
    built = await buildApp({ config, db: openDatabase(':memory:'), logger: false });
    app = built.app;
    await ensureInitialAdmin(built.repos, { username: 'admin', password: 'admin-password-1' });
  });

  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the API, public routes and feeds under the prefix only', async () => {
    expect((await app.inject({ method: 'GET', url: '/smart-rss/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/smart-rss/api/auth/status' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/smart-rss/api/sources' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(404);
    const feed = await app.inject({ method: 'GET', url: '/smart-rss/feeds/all.rss', headers: { host: 'example.com' } });
    expect(feed.statusCode).toBe(200);
    expect(feed.body).toContain('http://example.com/smart-rss/');
  });

  it('redirects the bare prefix and serves the web app for deep links', async () => {
    const bare = await app.inject({ method: 'GET', url: '/smart-rss' });
    const root = await app.inject({ method: 'GET', url: '/smart-rss/' });
    const deep = await app.inject({ method: 'GET', url: '/smart-rss/source/3' });
    const asset = await app.inject({ method: 'GET', url: '/smart-rss/assets/app.js' });
    const outside = await app.inject({ method: 'GET', url: '/somewhere-else' });

    expect(bare.statusCode).toBe(302);
    expect(bare.headers.location).toBe('/smart-rss/');
    for (const page of [root, deep]) {
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
      expect(page.body).toContain('<base href="/smart-rss/" />');
      expect(page.body).toContain('content="/smart-rss"');
    }
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');
    expect(outside.statusCode).toBe(404);
  });

  it('scopes the session cookie to the prefix and keeps access rules', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/smart-rss/api/auth/login',
      payload: { username: 'admin', password: 'admin-password-1' },
    });
    const cookie = login.cookies.find((c) => c.name === 'srss_session');
    const session = `srss_session=${cookie?.value}`;

    expect(cookie?.path).toBe('/smart-rss');
    expect((await app.inject({ method: 'GET', url: '/smart-rss/api/sources', headers: { cookie: session } })).statusCode).toBe(200);
    const logout = await app.inject({ method: 'POST', url: '/smart-rss/api/auth/logout', headers: { cookie: session } });
    expect(logout.cookies.find((c) => c.name === 'srss_session')?.path).toBe('/smart-rss');
  });
});
