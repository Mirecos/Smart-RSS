import {
  BACKUP_VERSION,
  backupSchema,
  httpUrlSchema,
  sourceConfigSchema,
  type Backup,
  type ImportResult,
  type SourceConfig,
} from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import { parseOrThrow, success } from '../lib/http.js';
import type { Repositories } from '../repositories/index.js';
import type { RouteContext } from './context.js';

export interface ImportEntry {
  name: string;
  url: string;
  category: string | null;
  refreshIntervalMinutes?: number;
  enabled?: boolean;
  config: SourceConfig;
}

export const DEFAULT_XML_CONFIG = (): SourceConfig => sourceConfigSchema.parse({ parser: { type: 'xml' } });

/** Creates sources that do not exist yet (matched by URL). Invalid entries are reported, not fatal. */
export function importSources(repos: Repositories, entries: ImportEntry[]): ImportResult {
  const { sources, categories, settings } = repos;
  const defaultRefresh = settings.get().defaultRefreshMinutes;
  const result: ImportResult = { created: 0, skipped: 0, errors: [] };
  for (const entry of entries) {
    const url = httpUrlSchema.safeParse(entry.url);
    if (!url.success) {
      result.errors.push(`${entry.name}: invalid URL "${entry.url}"`);
      continue;
    }
    if (sources.findByUrl(url.data)) {
      result.skipped++;
      continue;
    }
    sources.create({
      name: entry.name.slice(0, 200),
      url: url.data,
      categoryId: entry.category ? categories.ensure(entry.category.slice(0, 100)).id : null,
      refreshIntervalMinutes: entry.refreshIntervalMinutes ?? defaultRefresh,
      enabled: entry.enabled ?? true,
      config: entry.config,
    });
    result.created++;
  }
  return result;
}

export function registerBackupRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/export', async (_request, reply) => {
    const categories = ctx.repos.categories.list();
    const nameOf = new Map(categories.map((c) => [c.id, c.name]));
    const backup: Backup = {
      version: BACKUP_VERSION,
      exportedAt: ctx.now().toISOString(),
      categories: categories.map((c) => c.name),
      sources: ctx.repos.sources.list().map((s) => ({
        name: s.name,
        url: s.url,
        category: s.categoryId ? (nameOf.get(s.categoryId) ?? null) : null,
        refreshIntervalMinutes: s.refreshIntervalMinutes,
        enabled: s.enabled,
        config: s.config,
      })),
    };
    reply.header('content-disposition', 'attachment; filename="smart-rss-backup.json"');
    return success(backup);
  });

  app.post('/import', async (request) => {
    const backup = parseOrThrow(backupSchema, request.body);
    for (const name of backup.categories) ctx.repos.categories.ensure(name);
    return success(importSources(ctx.repos, backup.sources));
  });
}
