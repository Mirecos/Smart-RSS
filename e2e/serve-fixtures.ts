/** Serves canned remote sources for the E2E suite (started by playwright.config.ts). */
import { startFixtureServer } from '../apps/server/test/fixture-server.js';
import { API_JSON, ARTICLE_HTML, BLOG_HTML, RSS_FEED } from '../apps/server/test/fixtures.js';

const port = Number(process.env.FIXTURE_PORT ?? 4599);

const server = await startFixtureServer(
  {
    '/feed.xml': { body: RSS_FEED, headers: { 'content-type': 'application/rss+xml' } },
    '/blog': { body: BLOG_HTML, headers: { 'content-type': 'text/html' } },
    '/posts/one': { body: ARTICLE_HTML, headers: { 'content-type': 'text/html' } },
    '/api.json': { body: API_JSON, headers: { 'content-type': 'application/json' } },
    '/health': { body: 'ok' },
  },
  port,
);

process.stdout.write(`Fixture server listening on ${server.url}\n`);
process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
