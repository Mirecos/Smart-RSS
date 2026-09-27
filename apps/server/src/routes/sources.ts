import { sourceCreateSchema, sourceUpdateSchema } from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser } from '../auth/plugin.js';
import { HttpError, notFound, parseOrThrow, success } from '../lib/http.js';
import { addStarterSources } from '../seed/starter-sources.js';
import type { RouteContext } from './context.js';

export const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export function assertCategoryExists(ctx: RouteContext, categoryId: number | null | undefined): void {
  if (categoryId && !ctx.repos.categories.getById(categoryId)) {
    throw new HttpError(400, `Category ${categoryId} does not exist`);
  }
}

export function registerSourceRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sources, fetchLog } = ctx.repos;

  const requireSource = (id: number) => {
    const source = sources.getById(id);
    if (!source) throw notFound('Source');
    return source;
  };

  app.get('/sources', async (request) => success(sources.list(currentUser(request).id)));

  /** Adds the built-in starter sources (existing URLs are skipped) and fetches them right away. */
  app.post('/sources/starter', async () => {
    const result = addStarterSources(ctx.repos);
    ctx.scheduler.tick();
    return success(result);
  });

  app.get('/sources/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    requireSource(id);
    const source = sources.getById(id, currentUser(request).id);
    return success({ ...source, fetchLog: fetchLog.listForSource(id) });
  });

  app.post('/sources', async (request, reply) => {
    const input = parseOrThrow(sourceCreateSchema, request.body);
    assertCategoryExists(ctx, input.categoryId);
    const created = sources.create(input);
    if (created.enabled) void ctx.scheduler.refreshNow(created.id);
    return reply.status(201).send(success(created));
  });

  app.patch('/sources/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const patch = parseOrThrow(sourceUpdateSchema, request.body);
    requireSource(id);
    assertCategoryExists(ctx, patch.categoryId);
    const updated = sources.update(id, patch, ctx.now().toISOString());
    const needsRefresh = patch.url !== undefined || patch.config !== undefined || patch.enabled === true;
    if (updated?.enabled && needsRefresh) void ctx.scheduler.refreshNow(id);
    return success(updated);
  });

  app.delete('/sources/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    if (!sources.remove(id)) throw notFound('Source');
    return success(null);
  });

  app.post('/sources/:id/refresh', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    requireSource(id);
    return success(await ctx.scheduler.refreshNow(id));
  });
}
