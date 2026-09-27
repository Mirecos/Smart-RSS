import type { UserDto } from '@smart-rss/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../lib/http.js';
import type { Repositories } from '../repositories/index.js';
import { requiredAccess } from './access.js';

export const SESSION_COOKIE = 'srss_session';
const DAY_MS = 24 * 60 * 60 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    user: UserDto | null;
  }
}

export interface AuthDeps {
  repos: Repositories;
  sessionTtlMs: number;
  now: () => Date;
}

export function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string, ttlMs: number): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Loads the session user on every request and enforces the central access rule (see access.ts). */
export function registerAuth(app: FastifyInstance, deps: AuthDeps): void {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request, reply) => {
    const access = requiredAccess(request.method, request.url);
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const now = deps.now();
      const session = deps.repos.sessions.find(token, now);
      if (session) {
        request.user = session.user;
        // Sliding expiration: renew at most once a day.
        if (Date.parse(session.expiresAt) - now.getTime() < deps.sessionTtlMs - DAY_MS) {
          deps.repos.sessions.extend(token, new Date(now.getTime() + deps.sessionTtlMs));
          setSessionCookie(request, reply, token, deps.sessionTtlMs);
        }
      } else {
        clearSessionCookie(reply);
      }
    }
    if (access === 'public') return;
    if (!request.user) throw new HttpError(401, 'Authentication required');
    if (access === 'admin' && request.user.role !== 'admin') {
      throw new HttpError(403, 'Administrator access required');
    }
  });
}

/** For handlers behind the access rule: the user is always present there. */
export function currentUser(request: FastifyRequest): UserDto {
  if (!request.user) throw new HttpError(401, 'Authentication required');
  return request.user;
}
