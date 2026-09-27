import type { HealthDto } from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import { success } from '../lib/http.js';
import { probeRenderer } from '../pipeline/render.js';
import type { RouteContext } from './context.js';

export const APP_VERSION = '0.1.0';
const RENDERER_CACHE_MS = 30_000;

export function registerHealthRoutes(app: FastifyInstance, ctx: RouteContext): void {
  let cached: { at: number; reachable: boolean } | null = null;

  const rendererReachable = async (): Promise<boolean> => {
    const url = ctx.config.rendererUrl;
    if (!url) return false;
    const now = Date.now();
    if (cached && now - cached.at < RENDERER_CACHE_MS) return cached.reachable;
    cached = { at: now, reachable: await probeRenderer(url, ctx.pipeline.fetchImpl) };
    return cached.reachable;
  };

  app.get('/health', async () => {
    ctx.repos.settings.get(); // touches the database
    const health: HealthDto = {
      status: 'ok',
      version: APP_VERSION,
      renderer: { configured: Boolean(ctx.config.rendererUrl), reachable: await rendererReachable() },
    };
    return success(health);
  });
}
