import { loginSchema, passwordChangeSchema, type AuthStatusDto } from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import type { LoginLimiter } from '../auth/login-limiter.js';
import { clearSessionCookie, currentUser, SESSION_COOKIE, setSessionCookie } from '../auth/plugin.js';
import { HttpError, parseOrThrow, success } from '../lib/http.js';
import { dummyHash, hashPassword, verifyPassword } from '../lib/password.js';
import type { RouteContext } from './context.js';

export interface AuthRouteDeps {
  /** Failures per IP + username. */
  accountLimiter: LoginLimiter;
  /** Failures per IP, across usernames (guessing many accounts). */
  ipLimiter: LoginLimiter;
  sessionTtlMs: number;
}

const INVALID_CREDENTIALS = 'Invalid username or password';

export function registerAuthRoutes(app: FastifyInstance, ctx: RouteContext, deps: AuthRouteDeps): void {
  const { users, sessions } = ctx.repos;

  const assertNotThrottled = (accountKey: string, ip: string) => {
    const blocked: [LoginLimiter, string] | null = deps.accountLimiter.isBlocked(accountKey)
      ? [deps.accountLimiter, accountKey]
      : deps.ipLimiter.isBlocked(ip)
        ? [deps.ipLimiter, ip]
        : null;
    if (!blocked) return;
    const minutes = Math.ceil(blocked[0].retryAfterSeconds(blocked[1]) / 60);
    throw new HttpError(429, `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
  };

  app.get('/auth/status', async () => success<AuthStatusDto>({ hasUsers: users.count() > 0 }));

  app.post('/auth/login', async (request, reply) => {
    const { username, password } = parseOrThrow(loginSchema, request.body);
    const accountKey = `${request.ip}|${username.toLowerCase()}`;
    assertNotThrottled(accountKey, request.ip);

    const credentials = users.findCredentials(username);
    // Always run one scrypt verification so unknown usernames take as long as wrong passwords.
    const valid = await verifyPassword(password, credentials?.passwordHash ?? (await dummyHash()));
    if (!credentials || !valid) {
      deps.accountLimiter.recordFailure(accountKey);
      deps.ipLimiter.recordFailure(request.ip);
      request.log.warn({ username, ip: request.ip }, 'Failed login');
      throw new HttpError(401, INVALID_CREDENTIALS);
    }

    deps.accountLimiter.reset(accountKey);
    const now = ctx.now();
    sessions.purgeExpired(now);
    setSessionCookie(request, reply, sessions.create(credentials.user.id, now, deps.sessionTtlMs), deps.sessionTtlMs);
    request.log.info({ userId: credentials.user.id }, 'User logged in');
    return success(credentials.user);
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) sessions.remove(token);
    clearSessionCookie(reply);
    return success(null);
  });

  app.get('/auth/me', async (request) => success(currentUser(request)));

  /** Changes the caller's own password and signs out their other sessions. */
  app.post('/auth/password', async (request) => {
    const user = currentUser(request);
    const { currentPassword, newPassword } = parseOrThrow(passwordChangeSchema, request.body);
    const storedHash = users.getPasswordHash(user.id);
    if (!storedHash || !(await verifyPassword(currentPassword, storedHash))) {
      // 400 rather than 401: the session is valid, only the confirmation is wrong.
      throw new HttpError(400, 'Current password is incorrect');
    }
    users.update(user.id, { passwordHash: await hashPassword(newPassword) }, ctx.now().toISOString());
    sessions.removeForUser(user.id, request.cookies[SESSION_COOKIE]);
    return success(null);
  });
}
