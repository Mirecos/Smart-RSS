import { sourceCreateSchema, type ParsedItem } from '@smart-rss/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../app.js';
import { ensureInitialAdmin } from '../auth/bootstrap.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';

const ADMIN = { username: 'admin', password: 'admin-password-1' };
const DAY_MS = 86_400_000;

let built: BuiltApp;
let app: FastifyInstance;
let clock: Date;

beforeEach(async () => {
  clock = new Date('2024-06-01T12:00:00.000Z');
  const config = loadConfig({ LOG_LEVEL: 'silent', SCHEDULER_ENABLED: 'false', SESSION_TTL_DAYS: '30' });
  built = await buildApp({ config, db: openDatabase(':memory:'), logger: false, now: () => clock });
  app = built.app;
  await ensureInitialAdmin(built.repos, ADMIN);
});

afterEach(async () => {
  await built.scheduler.stop();
  await app.close();
});

async function call(options: InjectOptions & { as?: string | null }) {
  const { as = null, ...rest } = options;
  const response = await app.inject({ ...rest, headers: { ...(rest.headers ?? {}), ...(as ? { cookie: as } : {}) } });
  return { status: response.statusCode, body: response.json(), cookies: response.cookies };
}

async function login(username: string, password: string): Promise<string> {
  const response = await call({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  const session = response.cookies.find((cookie) => cookie.name === 'srss_session');
  if (!session) throw new Error(`login failed: ${JSON.stringify(response.body)}`);
  return `srss_session=${session.value}`;
}

async function createUser(adminCookie: string, username: string, role: 'user' | 'admin' = 'user') {
  const password = `${username}-password`;
  const { body } = await call({ method: 'POST', url: '/api/users', payload: { username, password, role }, as: adminCookie });
  return { id: body.data.id as number, cookie: await login(username, password) };
}

function seedItems() {
  const source = built.repos.sources.create(sourceCreateSchema.parse({ name: 'S', url: 'https://s.example.com/rss', config: { parser: { type: 'xml' } } }));
  const item = (guid: string): ParsedItem => ({ guid, title: guid, link: null, content: 'c', summary: null, author: null, image: null, categories: [], publishedAt: null });
  built.repos.items.upsertMany(source.id, [item('a'), item('b')], clock.toISOString());
  return source;
}

describe('authentication', () => {
  it('keeps the API closed to anonymous callers, except health and auth status', async () => {
    expect((await call({ method: 'GET', url: '/api/sources' })).status).toBe(401);
    expect((await call({ method: 'GET', url: '/api/items' })).status).toBe(401);
    expect((await call({ method: 'GET', url: '/api/auth/me' })).status).toBe(401);
    expect((await call({ method: 'GET', url: '/api/health' })).status).toBe(200);
    expect((await call({ method: 'GET', url: '/api/auth/status' })).body.data).toEqual({ hasUsers: true });
  });

  it('logs in with a hardened session cookie and logs out', async () => {
    const response = await call({ method: 'POST', url: '/api/auth/login', payload: { username: 'ADMIN', password: ADMIN.password } });
    const cookie = response.cookies.find((c) => c.name === 'srss_session');
    const session = `srss_session=${cookie?.value}`;

    expect(response.body.data).toMatchObject({ username: 'admin', role: 'admin' });
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 30 * 86_400 });
    expect((await call({ method: 'GET', url: '/api/auth/me', as: session })).body.data.username).toBe('admin');

    await call({ method: 'POST', url: '/api/auth/logout', as: session });
    expect((await call({ method: 'GET', url: '/api/auth/me', as: session })).status).toBe(401);
  });

  it('gives the same answer for unknown users and wrong passwords', async () => {
    const wrongPassword = await call({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'nope-nope' } });
    const unknownUser = await call({ method: 'POST', url: '/api/auth/login', payload: { username: 'ghost', password: 'nope-nope' } });

    expect(wrongPassword).toMatchObject({ status: 401, body: { error: { message: 'Invalid username or password' } } });
    expect(unknownUser).toMatchObject({ status: 401, body: { error: { message: 'Invalid username or password' } } });
  });

  it('throttles repeated failures for an account, even with the right password afterwards', async () => {
    for (let i = 0; i < 5; i++) {
      await call({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: `wrong-${i}` } });
    }

    const blocked = await call({ method: 'POST', url: '/api/auth/login', payload: ADMIN });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toMatch(/Too many failed attempts/);
  });

  it('expires sessions after the configured lifetime and slides them while in use', async () => {
    const session = await login(ADMIN.username, ADMIN.password);

    clock = new Date(clock.getTime() + 2 * DAY_MS);
    const renewed = await call({ method: 'GET', url: '/api/auth/me', as: session });
    expect(renewed.status).toBe(200);
    expect(renewed.cookies.find((c) => c.name === 'srss_session')?.value).toBeTruthy();

    clock = new Date(clock.getTime() + 31 * DAY_MS);
    const expired = await call({ method: 'GET', url: '/api/auth/me', as: session });
    expect(expired.status).toBe(401);
    expect(expired.cookies.find((c) => c.name === 'srss_session')?.value).toBe('');
  });

  it('changes the own password and signs out the other sessions', async () => {
    const current = await login(ADMIN.username, ADMIN.password);
    const other = await login(ADMIN.username, ADMIN.password);

    const wrong = await call({ method: 'POST', url: '/api/auth/password', payload: { currentPassword: 'bad-bad-bad', newPassword: 'new-password-1' }, as: current });
    const ok = await call({ method: 'POST', url: '/api/auth/password', payload: { currentPassword: ADMIN.password, newPassword: 'new-password-1' }, as: current });

    expect(wrong).toMatchObject({ status: 400, body: { error: { message: 'Current password is incorrect' } } });
    expect(ok.status).toBe(200);
    expect((await call({ method: 'GET', url: '/api/auth/me', as: current })).status).toBe(200);
    expect((await call({ method: 'GET', url: '/api/auth/me', as: other })).status).toBe(401);
    expect((await call({ method: 'POST', url: '/api/auth/login', payload: ADMIN })).status).toBe(401);
    await expect(login(ADMIN.username, 'new-password-1')).resolves.toMatch(/^srss_session=/);
  });
});

describe('roles', () => {
  it('lets regular users read and manage their own reading state only', async () => {
    const admin = await login(ADMIN.username, ADMIN.password);
    const reader = await createUser(admin, 'reader');
    const source = seedItems();
    const [first] = (await call({ method: 'GET', url: '/api/items', as: reader.cookie })).body.data;

    const allowed = [
      await call({ method: 'GET', url: '/api/sources', as: reader.cookie }),
      await call({ method: 'GET', url: '/api/settings', as: reader.cookie }),
      await call({ method: 'PATCH', url: `/api/items/${first.id}`, payload: { isStarred: true }, as: reader.cookie }),
      await call({ method: 'POST', url: '/api/items/mark-read', payload: { sourceId: source.id }, as: reader.cookie }),
    ];
    const forbidden = [
      await call({ method: 'POST', url: '/api/sources', payload: { name: 'x', url: 'https://x.example.com', config: { parser: { type: 'xml' } } }, as: reader.cookie }),
      await call({ method: 'DELETE', url: `/api/sources/${source.id}`, as: reader.cookie }),
      await call({ method: 'POST', url: '/api/preview', payload: {}, as: reader.cookie }),
      await call({ method: 'PATCH', url: '/api/settings', payload: { retentionDays: 1 }, as: reader.cookie }),
      await call({ method: 'GET', url: '/api/users', as: reader.cookie }),
      await call({ method: 'GET', url: '/api/export', as: reader.cookie }),
      await call({ method: 'POST', url: '/api/sources/starter', as: reader.cookie }),
    ];

    expect(allowed.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(forbidden.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
    expect(forbidden[0]?.body.error.message).toBe('Administrator access required');
  });

  it('keeps read and starred state personal to each user', async () => {
    const admin = await login(ADMIN.username, ADMIN.password);
    const reader = await createUser(admin, 'reader');
    const source = seedItems();
    const [item] = (await call({ method: 'GET', url: '/api/items', as: admin })).body.data;

    await call({ method: 'PATCH', url: `/api/items/${item.id}`, payload: { isStarred: true, isRead: true }, as: admin });
    await call({ method: 'POST', url: '/api/items/mark-read', payload: {}, as: reader.cookie });

    const adminView = (await call({ method: 'GET', url: '/api/items?starred=true', as: admin })).body.data;
    const readerView = (await call({ method: 'GET', url: '/api/items?starred=true', as: reader.cookie })).body.data;
    const adminSources = (await call({ method: 'GET', url: '/api/sources', as: admin })).body.data;
    const readerSources = (await call({ method: 'GET', url: '/api/sources', as: reader.cookie })).body.data;
    const adminDetail = (await call({ method: 'GET', url: `/api/sources/${source.id}`, as: admin })).body.data;

    expect(adminView).toHaveLength(1);
    expect(readerView).toHaveLength(0);
    expect(adminSources[0].unreadCount).toBe(1);
    expect(readerSources[0].unreadCount).toBe(0);
    expect(adminDetail.unreadCount).toBe(1);
  });
});

describe('user management', () => {
  it('creates users, rejects duplicates and changes roles', async () => {
    const admin = await login(ADMIN.username, ADMIN.password);
    const reader = await createUser(admin, 'reader');

    const duplicate = await call({ method: 'POST', url: '/api/users', payload: { username: 'READER', password: 'whatever-1' }, as: admin });
    const invalid = await call({ method: 'POST', url: '/api/users', payload: { username: 'x', password: 'short' }, as: admin });
    const promoted = await call({ method: 'PATCH', url: `/api/users/${reader.id}`, payload: { role: 'admin' }, as: admin });

    expect(duplicate.status).toBe(409);
    expect(invalid.status).toBe(400);
    expect(promoted.body.data.role).toBe('admin');
    // Roles are read from the database on every request: the promotion applies immediately.
    expect((await call({ method: 'GET', url: '/api/users', as: reader.cookie })).status).toBe(200);
    expect((await call({ method: 'GET', url: '/api/users', as: admin })).body.data.map((u: { username: string }) => u.username)).toEqual(['admin', 'reader']);
  });

  it('protects the last administrator and the own account', async () => {
    const admin = await login(ADMIN.username, ADMIN.password);
    const adminId = built.repos.users.findCredentials('admin')!.user.id;

    const demote = await call({ method: 'PATCH', url: `/api/users/${adminId}`, payload: { role: 'user' }, as: admin });
    const deleteSelf = await call({ method: 'DELETE', url: `/api/users/${adminId}`, as: admin });
    const missing = await call({ method: 'DELETE', url: '/api/users/999', as: admin });

    expect(demote).toMatchObject({ status: 400, body: { error: { message: 'There must always be at least one administrator' } } });
    expect(deleteSelf).toMatchObject({ status: 400, body: { error: { message: 'You cannot delete your own account' } } });
    expect(missing.status).toBe(404);
  });

  it('signs a user out when an admin resets their password or deletes them', async () => {
    const admin = await login(ADMIN.username, ADMIN.password);
    const first = await createUser(admin, 'first');
    const second = await createUser(admin, 'second');

    await call({ method: 'PATCH', url: `/api/users/${first.id}`, payload: { password: 'reset-password-1' }, as: admin });
    await call({ method: 'DELETE', url: `/api/users/${second.id}`, as: admin });

    expect((await call({ method: 'GET', url: '/api/auth/me', as: first.cookie })).status).toBe(401);
    expect((await call({ method: 'GET', url: '/api/auth/me', as: second.cookie })).status).toBe(401);
    await expect(login('first', 'reset-password-1')).resolves.toMatch(/^srss_session=/);
    expect((await call({ method: 'GET', url: '/api/auth/me', as: admin })).status).toBe(200);
  });

  it('keeps the admin signed in when resetting their own password', async () => {
    const admin = await login(ADMIN.username, ADMIN.password);
    const adminId = built.repos.users.findCredentials('admin')!.user.id;

    await call({ method: 'PATCH', url: `/api/users/${adminId}`, payload: { password: 'self-reset-pw' }, as: admin });

    expect((await call({ method: 'GET', url: '/api/auth/me', as: admin })).status).toBe(200);
  });
});
