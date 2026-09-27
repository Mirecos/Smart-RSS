import { itemQuerySchema, itemUpdateSchema, markReadSchema } from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/plugin.js';
import { HttpError, notFound, parseOrThrow, success } from '../lib/http.js';
import { decodeCursor, encodeCursor } from '../repositories/items.js';
import type { RouteContext } from './context.js';
import { idParamsSchema } from './sources.js';

export function registerItemRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { items } = ctx.repos;

  app.get('/items', async (request) => {
    const query = parseOrThrow(itemQuerySchema, request.query);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !cursor) throw new HttpError(400, 'Invalid cursor');
    const page = items.list({ ...query, cursor, userId: currentUser(request).id });
    return success(page.items, { nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null });
  });

  app.patch('/items/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const patch = parseOrThrow(itemUpdateSchema, request.body);
    const updated = items.update(id, currentUser(request).id, patch);
    if (!updated) throw notFound('Item');
    return success(updated);
  });

  app.post('/items/mark-read', async (request) => {
    const scope = parseOrThrow(markReadSchema, request.body ?? {});
    return success({ updated: items.markRead(scope, currentUser(request).id) });
  });
}
