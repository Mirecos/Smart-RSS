import { settingsUpdateSchema } from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import { parseOrThrow, success } from '../lib/http.js';
import type { RouteContext } from './context.js';

export function registerSettingsRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/settings', async () => success(ctx.repos.settings.get()));

  app.patch('/settings', async (request) => {
    const patch = parseOrThrow(settingsUpdateSchema, request.body);
    return success(ctx.repos.settings.update(patch));
  });
}
