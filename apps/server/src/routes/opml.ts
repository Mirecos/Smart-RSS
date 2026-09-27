import { opmlImportSchema } from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError, parseOrThrow, success } from '../lib/http.js';
import { buildOpml, parseOpmlEntries } from '../output/opml.js';
import { DEFAULT_XML_CONFIG, importSources } from './backup.js';
import type { RouteContext } from './context.js';

export function registerOpmlRoutes(app: FastifyInstance, ctx: RouteContext): void {
  app.get('/opml', async (request, reply) => {
    const baseUrl = `${request.protocol}://${request.host}`;
    const xml = buildOpml(ctx.repos.categories.list(), ctx.repos.sources.list(), baseUrl);
    return reply
      .header('content-type', 'text/x-opml; charset=utf-8')
      .header('content-disposition', 'attachment; filename="smart-rss.opml"')
      .send(xml);
  });

  app.post('/opml', async (request) => {
    const { content } = parseOrThrow(opmlImportSchema, request.body);
    const entries = parseOpmlEntries(content);
    if (!entries.ok) throw new HttpError(400, entries.error.message);
    const config = DEFAULT_XML_CONFIG();
    return success(importSources(ctx.repos, entries.value.map((entry) => ({ ...entry, config }))));
  });
}
