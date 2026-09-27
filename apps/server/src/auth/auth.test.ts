import type { ParsedItem } from '@smart-rss/shared';
import { sourceCreateSchema } from '@smart-rss/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { createRepositories } from '../repositories/index.js';
import { requiredAccess } from './access.js';
import { ensureInitialAdmin } from './bootstrap.js';
import { createLoginLimiter } from './login-limiter.js';

describe('password hashing', () => {
  it('hashes with a random salt and verifies only the right password', async () => {
    const first = await hashPassword('correct horse');
    const second = await hashPassword('correct horse');

    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword('correct horse', first)).toBe(true);
    expect(await verifyPassword('wrong horse', first)).toBe(false);
  });

  it.each([
    'plain-text',
    'bcrypt$10$abc',
    'scrypt$16384$8$1$c2FsdA==',
    'scrypt$x$8$1$c2FsdA==$aGFzaA==',
    'scrypt$16384$8$1$c2FsdA==$',
    'scrypt$16384$8$1$c2FsdA==$aGFzaA==$extra',
    'scrypt$3$8$1$c2FsdA==$aGFzaA==',
  ])('never verifies a malformed hash: %s', async (stored) => {
    expect(await verifyPassword('anything', stored)).toBe(false);
  });
});

describe('requiredAccess', () => {
  it.each([
    ['GET', '/', 'public'],
    ['GET', '/feeds/all.rss', 'public'],
    ['GET', '/api/health', 'public'],
    ['GET', '/api/auth/status', 'public'],
    ['POST', '/api/auth/login', 'public'],
    ['GET', '/api/auth/me', 'user'],
    ['POST', '/api/auth/logout', 'user'],
    ['POST', '/api/auth/password', 'user'],
    ['GET', '/api/items?unread=true', 'user'],
    ['PATCH', '/api/items/12', 'user'],
    ['POST', '/api/items/mark-read', 'user'],
    ['GET', '/api/sources', 'user'],
    ['GET', '/api/settings', 'user'],
    ['GET', '/api/users', 'admin'],
    ['GET', '/api/users/3', 'admin'],
    ['GET', '/api/export', 'admin'],
    ['GET', '/api/opml', 'admin'],
    ['POST', '/api/sources', 'admin'],
    ['PATCH', '/api/sources/1', 'admin'],
    ['DELETE', '/api/items/12', 'admin'],
    ['POST', '/api/preview', 'admin'],
    ['PATCH', '/api/settings', 'admin'],
    ['POST', '/api/users', 'admin'],
    ['POST', '/api/something-new', 'admin'],
    ['GET', '/api/something-new', 'user'],
  ])('%s %s requires %s', (method, url, expected) => {
    expect(requiredAccess(method, url)).toBe(expected);
  });
});

describe('login limiter', () => {
  it('blocks after too many failures within the window, then forgets them', () => {
    let clock = 0;
    const limiter = createLoginLimiter({ maxFailures: 2, windowMs: 1000, now: () => clock });

    limiter.recordFailure('k');
    expect(limiter.isBlocked('k')).toBe(false);
    limiter.recordFailure('k');
    expect(limiter.isBlocked('k')).toBe(true);
    expect(limiter.retryAfterSeconds('k')).toBe(1);
    expect(limiter.isBlocked('other')).toBe(false);

    clock = 1001;
    expect(limiter.isBlocked('k')).toBe(false);
    expect(limiter.retryAfterSeconds('k')).toBe(0);
  });

  it('can be reset after a successful login', () => {
    const limiter = createLoginLimiter({ maxFailures: 1, windowMs: 60_000 });
    limiter.recordFailure('k');

    limiter.reset('k');

    expect(limiter.isBlocked('k')).toBe(false);
  });
});

describe('initial admin bootstrap', () => {
  const item = (guid: string): ParsedItem => ({
    guid, title: guid, link: null, content: 'c', summary: null, author: null, image: null, categories: [], publishedAt: null,
  });

  it('creates the admin once and hands over the pre-auth read/star state', async () => {
    const db = openDatabase(':memory:');
    const repos = createRepositories(db);
    const source = repos.sources.create(sourceCreateSchema.parse({ name: 's', url: 'https://s.example.com', config: { parser: { type: 'xml' } } }));
    repos.items.upsertMany(source.id, [item('read'), item('starred'), item('untouched')], '2024-01-01T00:00:00.000Z');
    db.exec("UPDATE items SET is_read = 1 WHERE guid = 'read'; UPDATE items SET is_starred = 1 WHERE guid = 'starred'");

    const created = await ensureInitialAdmin(repos, { username: 'boss', password: 'boss-password' });
    const again = await ensureInitialAdmin(repos, { username: 'other', password: 'other-password' });

    const admin = repos.users.findCredentials('BOSS');
    expect(created).toBe('created');
    expect(again).toBe('exists');
    expect(admin?.user.role).toBe('admin');
    expect(await verifyPassword('boss-password', admin?.passwordHash ?? '')).toBe(true);
    const items = repos.items.list({ userId: admin!.user.id, limit: 10 }).items;
    expect(items.find((i) => i.guid === 'read')?.isRead).toBe(true);
    expect(items.find((i) => i.guid === 'starred')?.isStarred).toBe(true);
    expect(items.find((i) => i.guid === 'untouched')).toMatchObject({ isRead: false, isStarred: false });
  });

  it('does nothing when credentials are not configured', async () => {
    const repos = createRepositories(openDatabase(':memory:'));

    expect(await ensureInitialAdmin(repos, { username: null, password: null })).toBe('not-configured');
    expect(repos.users.count()).toBe(0);
  });
});

describe('auth configuration', () => {
  it('reads admin credentials, session lifetime and proxy trust', () => {
    const config = loadConfig({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'long-enough', SESSION_TTL_DAYS: '7', TRUST_PROXY: 'true' });

    expect(config.auth).toEqual({ adminUsername: 'admin', adminPassword: 'long-enough', sessionTtlMs: 7 * 86_400_000 });
    expect(config.trustProxy).toBe(true);
  });

  it('treats empty values (from Docker Compose) as unset', () => {
    const config = loadConfig({ ADMIN_USERNAME: '', ADMIN_PASSWORD: '' });

    expect(config.auth.adminUsername).toBeNull();
    expect(config.auth.sessionTtlMs).toBe(30 * 86_400_000);
  });

  it('fails fast on unsafe or incomplete admin settings without echoing the password', () => {
    expect(() => loadConfig({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'short' })).toThrow(/ADMIN_PASSWORD/);
    expect(() => loadConfig({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'short' })).not.toThrow(/short/);
    expect(() => loadConfig({ ADMIN_USERNAME: 'admin' })).toThrow(/both ADMIN_USERNAME and ADMIN_PASSWORD/);
    expect(() => loadConfig({ ADMIN_USERNAME: 'bad name!', ADMIN_PASSWORD: 'long-enough' })).toThrow(/ADMIN_USERNAME/);
  });
});
