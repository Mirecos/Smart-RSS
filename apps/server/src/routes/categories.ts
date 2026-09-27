import { categoryInputSchema } from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser } from '../auth/plugin.js';
import { HttpError, notFound, parseOrThrow, success } from '../lib/http.js';
import type { RouteContext } from './context.js';
import { idParamsSchema } from './sources.js';

export function registerCategoryRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { categories } = ctx.repos;

  const assertNameAvailable = (name: string, exceptId?: number) => {
    const existing = categories.findByName(name);
    if (existing && existing.id !== exceptId) throw new HttpError(409, `Category "${name}" already exists`);
  };

  app.get('/categories', async (request) => success(categories.list(currentUser(request).id)));

  app.post('/categories', async (request, reply) => {
    const { name } = parseOrThrow(categoryInputSchema, request.body);
    assertNameAvailable(name);
    return reply.status(201).send(success(categories.create(name)));
  });

  app.patch('/categories/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const { name } = parseOrThrow(categoryInputSchema, request.body);
    if (!categories.getById(id)) throw notFound('Category');
    assertNameAvailable(name, id);
    return success(categories.rename(id, name));
  });

  app.delete('/categories/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    if (!categories.remove(id)) throw notFound('Category');
    return success(null);
  });
}
