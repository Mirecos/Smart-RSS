import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { injectBasePath, stripBasePath } from './lib/base-path.js';
import { HttpError } from './lib/http.js';
import type { PipelineDeps } from './pipeline/run.js';
import type { FetchImpl } from './pipeline/types.js';
import { createLoginLimiter } from './auth/login-limiter.js';
import { registerAuth } from './auth/plugin.js';
import { createRepositories, type Repositories } from './repositories/index.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBackupRoutes } from './routes/backup.js';
import { registerCategoryRoutes } from './routes/categories.js';
import type { RouteContext } from './routes/context.js';
import { registerFeedRoutes } from './routes/feeds.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerItemRoutes } from './routes/items.js';
import { registerOpmlRoutes } from './routes/opml.js';
import { registerPreviewRoutes } from './routes/preview.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSourceRoutes } from './routes/sources.js';
import { registerUserRoutes } from './routes/users.js';
import { createRefresher } from './scheduler/refresh.js';
import { createScheduler, type Scheduler } from './scheduler/scheduler.js';

const BODY_LIMIT_BYTES = 6 * 1024 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_ACCOUNT = 5;
const MAX_FAILURES_PER_IP = 20;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' https: http: data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export interface AppDeps {
  config: AppConfig;
  db: Db;
  fetchImpl?: FetchImpl;
  now?: () => Date;
  logger?: FastifyServerOptions['logger'];
}

export interface BuiltApp {
  app: FastifyInstance;
  scheduler: Scheduler;
  repos: Repositories;
}

const errorBody = (message: string, details?: unknown) => ({
  success: false,
  data: null,
  error: details === undefined ? { message } : { message, details },
});

function registerSecurity(app: FastifyInstance, config: AppConfig): void {
  // No authentication: reject cross-site writes (CSRF) from other origins the browser may have open.
  app.addHook('onRequest', async (request) => {
    const path = stripBasePath(request.url, config.basePath);
    if (!path?.startsWith('/api/') || SAFE_METHODS.has(request.method)) return;
    // Modern browsers always send Sec-Fetch-Site; "same-site" covers other ports on localhost, so reject it too.
    const fetchSite = request.headers['sec-fetch-site'];
    const origin = request.headers.origin;
    const explicitlyAllowed = Boolean(origin && config.allowedOrigins.includes(origin));
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none' && !explicitlyAllowed) {
      throw new HttpError(403, 'Cross-site request rejected');
    }
    if (!origin) return;
    let originHost: string;
    let requestHost: string;
    try {
      const originUrl = new URL(origin);
      originHost = originUrl.host;
      requestHost = new URL(`${originUrl.protocol}//${request.headers.host ?? ''}`).host;
    } catch {
      throw new HttpError(403, 'Invalid Origin header');
    }
    if (originHost !== requestHost && !config.allowedOrigins.includes(origin)) {
      throw new HttpError(403, 'Cross-origin request rejected');
    }
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
  });
}

/** The web app's index.html with the base path injected (served for "/" and every client-side route). */
function loadIndexHtml(webDistDir: string | null, basePath: string): string | null {
  const file = webDistDir ? join(webDistDir, 'index.html') : null;
  return file && existsSync(file) ? injectBasePath(readFileSync(file, 'utf8'), basePath) : null;
}

function registerErrorHandling(app: FastifyInstance, indexHtml: string | null, basePath: string): void {
  app.setErrorHandler((error: FastifyError | HttpError, request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send(errorBody(error.message, error.details));
    }
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) request.log.error({ err: error }, 'Unhandled error');
    return reply.status(status).send(errorBody(status >= 500 ? 'Internal server error' : error.message));
  });

  app.setNotFoundHandler((request, reply) => {
    const path = stripBasePath(request.url, basePath);
    const isAppRoute = path !== null && !path.startsWith('/api') && !path.startsWith('/feeds');
    if (indexHtml && request.method === 'GET' && isAppRoute) {
      return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(indexHtml);
    }
    return reply.status(404).send(errorBody('Route not found'));
  });
}

async function registerStatic(app: FastifyInstance, webDistDir: string | null, basePath: string): Promise<void> {
  if (!webDistDir) return;
  await app.register(fastifyStatic, {
    root: webDistDir,
    prefix: `${basePath}/`,
    // index.html is served by the not-found handler, with the base path injected.
    index: false,
    setHeaders: (reply, filePath) => {
      const immutable = /[\\/]assets[\\/]/.test(filePath);
      reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
}

export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
  const { config, db } = deps;
  const now = deps.now ?? (() => new Date());
  const app = Fastify({
    logger: deps.logger ?? { level: config.logLevel },
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: config.trustProxy,
  });
  const repos = createRepositories(db);
  const pipeline: PipelineDeps = {
    limits: config.fetchLimits,
    rendererUrl: config.rendererUrl,
    fetchImpl: deps.fetchImpl,
    now,
  };
  const refresh = createRefresher({
    repos,
    pipeline,
    maxConsecutiveFailures: config.scheduler.maxConsecutiveFailures,
    logger: app.log,
    now,
  });
  const scheduler = createScheduler({
    repos,
    refresh,
    tickSeconds: config.scheduler.tickSeconds,
    concurrency: config.scheduler.concurrency,
    logger: app.log,
    now,
  });
  const ctx: RouteContext = { config, repos, scheduler, pipeline, now };
  const webDistDir = config.webDistDir && existsSync(config.webDistDir) ? resolve(config.webDistDir) : null;

  const sessionTtlMs = config.auth.sessionTtlMs;
  const authDeps = {
    sessionTtlMs,
    accountLimiter: createLoginLimiter({ maxFailures: MAX_FAILURES_PER_ACCOUNT, windowMs: LOGIN_WINDOW_MS }),
    ipLimiter: createLoginLimiter({ maxFailures: MAX_FAILURES_PER_IP, windowMs: LOGIN_WINDOW_MS }),
  };

  // Order matters: CSRF check, then cookie parsing, then session loading + authorization.
  const { basePath } = config;
  registerSecurity(app, config);
  await app.register(fastifyCookie);
  registerAuth(app, { repos, sessionTtlMs, now, basePath });
  const indexHtml = loadIndexHtml(webDistDir, basePath);
  registerErrorHandling(app, indexHtml, basePath);
  if (basePath) app.get(basePath, async (_request, reply) => reply.redirect(`${basePath}/`));
  // The app's root page (a directory request, which the static plugin would refuse with 403).
  if (indexHtml) {
    app.get(`${basePath}/`, async (_request, reply) =>
      reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(indexHtml),
    );
  }
  await app.register(
    async (api) => {
      registerHealthRoutes(api, ctx);
      registerAuthRoutes(api, ctx, authDeps);
      registerUserRoutes(api, ctx);
      registerSourceRoutes(api, ctx);
      registerCategoryRoutes(api, ctx);
      registerItemRoutes(api, ctx);
      registerPreviewRoutes(api, ctx);
      registerOpmlRoutes(api, ctx);
      registerBackupRoutes(api, ctx);
      registerSettingsRoutes(api, ctx);
    },
    { prefix: `${basePath}/api` },
  );
  await app.register(async (scope) => registerFeedRoutes(scope, ctx), { prefix: basePath });
  await registerStatic(app, webDistDir, basePath);
  return { app, scheduler, repos };
}
