import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/http.js';
import { renderFeed, type OutputFormat } from '../output/feeds.js';
import type { ItemScope } from '../repositories/items.js';
import type { RouteContext } from './context.js';

const FEED_FILE = /^(all|category-(\d+)|source-(\d+))\.(rss|atom|json)$/;
const FEED_ITEMS = 50;

interface FeedScope {
  title: string;
  scope: ItemScope;
}

function resolveScope(ctx: RouteContext, match: RegExpExecArray): FeedScope {
  const [, , categoryId, sourceId] = match;
  if (categoryId) {
    const category = ctx.repos.categories.getById(Number(categoryId));
    if (!category) throw notFound('Category');
    return { title: `Smart RSS · ${category.name}`, scope: { categoryId: category.id } };
  }
  if (sourceId) {
    const source = ctx.repos.sources.getById(Number(sourceId));
    if (!source) throw notFound('Source');
    return { title: `Smart RSS · ${source.name}`, scope: { sourceId: source.id } };
  }
  return { title: 'Smart RSS · All items', scope: {} };
}

/**
 * Public re-published feeds: /feeds/{all|category-ID|source-ID}.{rss|atom|json}.
 * They carry no per-user state (read/starred are personal since authentication was added).
 */
export function registerFeedRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/feeds/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    const match = FEED_FILE.exec(file);
    if (!match) throw notFound('Feed');
    const { title, scope } = resolveScope(ctx, match);
    const { items } = ctx.repos.items.list({ ...scope, userId: null, limit: FEED_ITEMS });
    const origin = `${request.protocol}://${request.host}`;
    const { body, contentType } = renderFeed(match[4] as OutputFormat, {
      title,
      siteUrl: `${origin}/`,
      selfUrl: `${origin}${request.url}`,
      items,
    });
    return reply.header('content-type', contentType).send(body);
  });
}
