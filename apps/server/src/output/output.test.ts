import { sourceConfigSchema, type ItemDto, type SourceDto } from '@smart-rss/shared';
import { parseFeed } from 'feedsmith';
import { describe, expect, it } from 'vitest';
import { renderFeed } from './feeds.js';
import { buildOpml, parseOpmlEntries } from './opml.js';

const item = (overrides: Partial<ItemDto> = {}): ItemDto => ({
  id: 1,
  sourceId: 2,
  sourceName: 'Src',
  guid: 'g1',
  title: 'Item title',
  link: 'https://example.com/1',
  contentHtml: '<p>content</p>',
  summary: 'summary',
  author: 'Ann',
  imageUrl: 'https://example.com/i.png',
  categories: ['tag'],
  publishedAt: '2024-01-01T00:00:00.000Z',
  fetchedAt: '2024-01-02T00:00:00.000Z',
  isRead: false,
  isStarred: false,
  ...overrides,
});

const feed = {
  title: 'Smart RSS · All',
  siteUrl: 'http://localhost:8080/',
  selfUrl: 'http://localhost:8080/feeds/all.rss',
  items: [item(), item({ id: 2, guid: 'g2', link: null, contentHtml: null, summary: null, author: null, categories: [], publishedAt: null })],
};

describe('renderFeed', () => {
  it.each(['rss', 'atom', 'json'] as const)('produces a valid %s feed that round-trips', (format) => {
    const { body, contentType } = renderFeed(format, feed);

    const parsed = parseFeed(format === 'json' ? JSON.parse(body) : body);

    expect(parsed.format).toBe(format);
    expect(contentType).toContain(format === 'json' ? 'feed+json' : `${format}+xml`);
    expect(body).toContain('Item title');
  });

  it('renders an empty atom feed', () => {
    expect(renderFeed('atom', { ...feed, items: [] }).body).toContain('<feed');
  });
});

describe('opml', () => {
  const config = sourceConfigSchema.parse({ parser: { type: 'xml' } });
  const htmlConfig = sourceConfigSchema.parse({ parser: { type: 'html', itemSelector: 'article' } });
  const source = (id: number, categoryId: number | null, overrides: Partial<SourceDto> = {}): SourceDto => ({
    id,
    name: `Source ${id}`,
    url: `https://s${id}.example.com/feed`,
    categoryId,
    refreshIntervalMinutes: 60,
    enabled: true,
    config,
    health: { lastFetchedAt: null, lastSuccessAt: null, lastError: null, consecutiveFailures: 0, pausedReason: null },
    unreadCount: 0,
    totalCount: 0,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  });

  it('exports grouped sources and imports them back', () => {
    const xml = buildOpml(
      [{ id: 1, name: 'Tech', unreadCount: 0 }, { id: 2, name: 'Empty', unreadCount: 0 }],
      [source(1, 1), source(2, null, { config: htmlConfig })],
      'http://localhost:8080',
    );

    const entries = parseOpmlEntries(xml);

    expect(entries.ok && entries.value).toEqual([
      { name: 'Source 1', url: 'https://s1.example.com/feed', category: 'Tech' },
      { name: 'Source 2', url: 'http://localhost:8080/feeds/source-2.rss', category: null },
    ]);
  });

  it('uses the outermost folder as category and rejects invalid documents', () => {
    const nested = `<?xml version="1.0"?><opml version="2.0"><head/><body>
      <outline text="Outer"><outline text="Inner"><outline text="F" xmlUrl="https://f.example.com/rss"/></outline></outline>
    </body></opml>`;

    const entries = parseOpmlEntries(nested);

    expect(entries.ok && entries.value).toEqual([{ name: 'F', url: 'https://f.example.com/rss', category: 'Outer' }]);
    expect(parseOpmlEntries('not xml at all').ok).toBe(false);
  });
});
