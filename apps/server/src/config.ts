import { passwordSchema, usernameSchema } from '@smart-rss/shared';
import { z } from 'zod';

const DAY_MS = 24 * 60 * 60 * 1000;

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Docker Compose passes unset variables as empty strings: treat them as missing. */
const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

const envSchema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATA_DIR: z.string().default('./data'),
  WEB_DIST_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  RENDERER_URL: z.string().optional(),
  FETCH_MAX_BYTES: z.coerce.number().int().min(10_000).default(5 * 1024 * 1024),
  FETCH_MAX_REDIRECTS: z.coerce.number().int().min(0).max(20).default(5),
  SCHEDULER_ENABLED: booleanFromEnv.default(true),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(5).default(60),
  SCHEDULER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  MAX_CONSECUTIVE_FAILURES: z.coerce.number().int().min(1).default(10),
  ALLOWED_ORIGINS: z.string().default(''),
  SEED_STARTER_SOURCES: booleanFromEnv.default(true),
  ADMIN_USERNAME: z.preprocess(emptyAsUndefined, usernameSchema.optional()),
  ADMIN_PASSWORD: z.preprocess(emptyAsUndefined, passwordSchema.optional()),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  TRUST_PROXY: booleanFromEnv.default(false),
});

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  webDistDir: string | null;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  rendererUrl: string | null;
  fetchLimits: { maxBytes: number; maxRedirects: number };
  scheduler: {
    enabled: boolean;
    tickSeconds: number;
    concurrency: number;
    maxConsecutiveFailures: number;
  };
  allowedOrigins: string[];
  /** Add the built-in starter sources on the very first start (empty database). */
  seedStarterSources: boolean;
  auth: {
    /** Used only to create the first admin when the database has no users. */
    adminUsername: string | null;
    adminPassword: string | null;
    sessionTtlMs: number;
  };
  /** Trust X-Forwarded-* headers (set when running behind a reverse proxy doing HTTPS). */
  trustProxy: boolean;
}

/** Parses environment variables and fails fast on invalid values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    // Never echo values: ADMIN_PASSWORD may be among the invalid ones.
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const e = result.data;
  if (Boolean(e.ADMIN_USERNAME) !== Boolean(e.ADMIN_PASSWORD)) {
    throw new Error('Invalid configuration: set both ADMIN_USERNAME and ADMIN_PASSWORD, or neither');
  }
  return {
    host: e.HOST,
    port: e.PORT,
    dataDir: e.DATA_DIR,
    webDistDir: e.WEB_DIST_DIR || null,
    logLevel: e.LOG_LEVEL,
    rendererUrl: e.RENDERER_URL || null,
    fetchLimits: { maxBytes: e.FETCH_MAX_BYTES, maxRedirects: e.FETCH_MAX_REDIRECTS },
    scheduler: {
      enabled: e.SCHEDULER_ENABLED,
      tickSeconds: e.SCHEDULER_TICK_SECONDS,
      concurrency: e.SCHEDULER_CONCURRENCY,
      maxConsecutiveFailures: e.MAX_CONSECUTIVE_FAILURES,
    },
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    seedStarterSources: e.SEED_STARTER_SOURCES,
    auth: {
      adminUsername: e.ADMIN_USERNAME ?? null,
      adminPassword: e.ADMIN_PASSWORD ?? null,
      sessionTtlMs: e.SESSION_TTL_DAYS * DAY_MS,
    },
    trustProxy: e.TRUST_PROXY,
  };
}
