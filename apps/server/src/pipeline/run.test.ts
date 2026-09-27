import { sourceConfigSchema } from '@smart-rss/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../../test/fixture-server.js';
import { ARTICLE_HTML, BLOG_HTML, RSS_FEED } from '../../test/fixtures.js';
import { probeRenderer, renderDocument, RENDERER_MISSING_MESSAGE } from './render.js';
import { runPipeline, type PipelineDeps } from './run.js';

const deps: PipelineDeps = { limits: { maxBytes: 1_000_000, maxRedirects: 3 }, rendererUrl: null };

describe('runPipeline', () => {
  let server: FixtureServer;

  beforeAll(async () => {
    const posts = BLOG_HTML.replaceAll('/posts/', '/articles/');
    server = await startFixtureServer({
      '/feed.xml': { body: RSS_FEED, headers: { 'content-type': 'application/rss+xml', etag: '"e1"' } },
      '/cached.xml': { handler: (req, res) => (req.headers['if-none-match'] === '"e1"' ? res.writeHead(304).end() : res.writeHead(200).end(RSS_FEED)) },
      '/blog': { body: posts, headers: { 'content-type': 'text/html' } },
      '/articles/one': { body: ARTICLE_HTML },
      '/articles/two': { status: 500 },
      '/dates.json': { body: JSON.stringify({ items: [{ title: 'a', url: 'https://x.example.com/a', date: '31.12.2023' }, { title: 'a', url: 'https://x.example.com/a', date: '??' }] }) },
    });
  });

  afterAll(() => server.close());

  it('turns an RSS feed into sanitized items with diagnostics', async () => {
    const config = sourceConfigSchema.parse({ parser: { type: 'xml' } });

    const result = await runPipeline({ url: `${server.url}/feed.xml`, config, mode: 'preview' }, deps);

    expect(result.status).toBe('ok');
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ guid: 'post-1', title: 'First & foremost', publishedAt: '2024-01-01T10:00:00.000Z' });
    expect(result.items[0]?.content).not.toContain('<script>');
    expect(result.items[0]?.content).toContain('src="https://blog.example.com/img/a.png"');
    expect(result.items[1]?.link).toBe(`${server.url}/second`);
    expect(result.validators.etag).toBe('"e1"');
    expect(result.diagnostics.map((d) => d.stage)).toEqual(['fetch', 'parse']);
    expect(result.sample).toContain('post-1');
  });

  it('reports not modified for scheduled fetches with validators', async () => {
    const config = sourceConfigSchema.parse({ parser: { type: 'xml' } });

    const result = await runPipeline({ url: `${server.url}/cached.xml`, config, mode: 'scheduled', etag: '"e1"' }, deps);

    expect(result.status).toBe('not_modified');
  });

  it('scrapes HTML, filters and extracts full text for new items only', async () => {
    const config = sourceConfigSchema.parse({
      parser: { type: 'html', itemSelector: 'article.post' },
      fullText: { mode: 'readability' },
      filters: [{ mode: 'exclude', field: 'title', pattern: 'nothing-matches' }],
    });

    const result = await runPipeline(
      { url: `${server.url}/blog`, config, mode: 'scheduled', knownGuids: () => new Set() },
      deps,
    );

    expect(result.status).toBe('ok');
    expect(result.items[0]?.content).toContain('complete article text');
    expect(result.items[1]?.content).toBeNull();
    const messages = result.diagnostics.map((d) => d.message).join('\n');
    expect(messages).toMatch(/Filters kept 2 of 2/);
    expect(messages).toMatch(/Full text extracted for 1 of 2/);
    expect(messages).toMatch(/1 extraction failed/);
  });

  it('extracts full text with a CSS selector and skips known items', async () => {
    const config = sourceConfigSchema.parse({
      parser: { type: 'html', itemSelector: 'article.post' },
      fullText: { mode: 'selector', selector: '.article-body' },
    });

    const result = await runPipeline(
      { url: `${server.url}/blog`, config, mode: 'scheduled', knownGuids: (guids) => new Set(guids.slice(1)) },
      deps,
    );

    expect(result.items[0]?.content).toContain('Another paragraph');
    expect(result.diagnostics.map((d) => d.message).join('\n')).toMatch(/Full text extracted for 1 of 1/);
  });

  it('warns about unparseable dates and merged duplicates', async () => {
    const config = sourceConfigSchema.parse({
      parser: { type: 'json', itemsPath: '$.items[*]', fields: { publishedAt: { path: 'date', dateFormat: 'dd.MM.yyyy' } } },
      dedupeBy: 'link',
    });

    const result = await runPipeline({ url: `${server.url}/dates.json`, config, mode: 'preview' }, deps);

    expect(result.items).toHaveLength(1);
    const warnings = result.diagnostics.filter((d) => d.level === 'warning').map((d) => d.message);
    expect(warnings).toEqual([
      '1 item with an unparseable date with format "dd.MM.yyyy"',
      '1 duplicate item merged (same link)',
    ]);
  });

  it('fails with a helpful hint when an HTML page is configured as a feed', async () => {
    const config = sourceConfigSchema.parse({ parser: { type: 'xml' } });

    const result = await runPipeline({ url: `${server.url}/blog`, config, mode: 'preview' }, deps);

    expect(result.status).toBe('error');
    expect(result.error).toMatch(/Not a valid RSS/);
    expect(result.diagnostics.at(-1)?.message).toMatch(/advertises these feeds/);
  });

  it('fails on fetch errors', async () => {
    const config = sourceConfigSchema.parse({ parser: { type: 'xml' } });

    const result = await runPipeline({ url: `${server.url}/missing`, config, mode: 'preview' }, deps);

    expect(result).toMatchObject({ status: 'error', items: [], error: 'HTTP 404 Not Found' });
  });

  it('fails clearly when JavaScript rendering is requested without a renderer', async () => {
    const config = sourceConfigSchema.parse({ parser: { type: 'xml' }, fetch: { render: true } });

    const result = await runPipeline({ url: `${server.url}/feed.xml`, config, mode: 'preview' }, deps);

    expect(result.error).toBe(RENDERER_MISSING_MESSAGE);
  });
});

describe('renderer helpers', () => {
  it('reports connection failures instead of throwing', async () => {
    const options = sourceConfigSchema.parse({ parser: { type: 'xml' } }).fetch;

    const result = await renderDocument('https://example.com', { ...options, timeoutMs: 1000 }, 'ws://127.0.0.1:1');

    expect(!result.ok && result.error.message).toMatch(/Rendering failed/);
  });

  it('probes the renderer http endpoint', async () => {
    const fakeFetch = (async (url: URL) => {
      expect(url.toString()).toBe('http://renderer:3000/json/version?token=t');
      return new Response('{}');
    }) as unknown as typeof fetch;

    expect(await probeRenderer('ws://renderer:3000?token=t', fakeFetch)).toBe(true);
    expect(await probeRenderer('not a url')).toBe(false);
  });
});
