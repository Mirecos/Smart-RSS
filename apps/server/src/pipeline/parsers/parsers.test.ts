import { parserSchema, type ParserConfig } from '@smart-rss/shared';
import { describe, expect, it } from 'vitest';
import { API_JSON, ATOM_FEED, BLOG_HTML, JSON_FEED, RDF_FEED, RSS_FEED } from '../../../test/fixtures.js';
import { discoverFeeds } from './html.js';
import { parseDocument, parseHint } from './index.js';

const BASE = 'https://blog.example.com/';
const parser = (input: unknown): ParserConfig => parserSchema.parse(input);

function parseOk(body: string, config: ParserConfig) {
  const result = parseDocument(body, config, BASE);
  if (!result.ok) throw new Error(`expected success, got: ${result.error.message}`);
  return result.value;
}

function parseError(body: string, config: ParserConfig): string {
  const result = parseDocument(body, config, BASE);
  if (result.ok) throw new Error('expected failure');
  return result.error.message;
}

describe('xml parser', () => {
  it('maps RSS items with sensible defaults', () => {
    const { items, total, sample } = parseOk(RSS_FEED, parser({ type: 'xml' }));

    expect(total).toBe(2);
    expect(items[0]).toMatchObject({
      id: 'post-1',
      title: 'First & foremost',
      link: 'https://blog.example.com/first',
      summary: '<p>Short summary</p>',
      author: 'Alice',
      publishedAt: 'Mon, 01 Jan 2024 10:00:00 GMT',
      image: 'https://blog.example.com/thumb.jpg',
      categories: ['News', 'Tech'],
    });
    expect(items[0]?.content).toContain('Full <b>content</b>');
    expect(items[1]).toMatchObject({ link: '/second', image: 'https://blog.example.com/cover.png' });
    expect(sample).toContain('"title": "First & foremost"');
  });

  it('lets field rules override defaults with JSONPath', () => {
    const { items } = parseOk(RSS_FEED, parser({ type: 'xml', fields: { author: { path: 'categories[0].name' } } }));

    expect(items[0]?.author).toBe('News');
  });

  it('maps Atom, RDF and JSON Feed documents', () => {
    const atom = parseOk(ATOM_FEED, parser({ type: 'xml' })).items[0];
    const rdf = parseOk(RDF_FEED, parser({ type: 'xml' })).items[0];
    const jsonFeed = parseOk(JSON_FEED, parser({ type: 'json' })).items[0];

    expect(atom).toMatchObject({
      id: 'urn:uuid:entry-1',
      title: 'Atom entry',
      link: 'https://atom.example.com/entry-1',
      content: '<p>Atom content</p>',
      summary: 'Atom summary',
      author: 'Bob',
      publishedAt: '2024-01-02T08:00:00Z',
      categories: ['Science'],
    });
    expect(rdf).toMatchObject({ id: 'https://rdf.example.com/1', title: 'RDF item', author: 'Carol', publishedAt: '2024-01-01T00:00:00Z' });
    expect(jsonFeed).toMatchObject({ id: 'jf-1', title: 'JSON Feed item', author: 'Dana', categories: ['a', 'b'], image: 'https://json.example.com/i.png' });
  });

  it('rejects documents that are not feeds', () => {
    expect(parseError('<html><body>hi</body></html>', parser({ type: 'xml' }))).toMatch(/Not a valid RSS/);
  });
});

describe('json parser', () => {
  it('maps arbitrary JSON with an items path and field rules', () => {
    const config = parser({
      type: 'json',
      itemsPath: '$.data.posts[*]',
      fields: {
        id: { path: 'slug' },
        publishedAt: { path: 'created', dateFormat: 'dd/MM/yyyy HH:mm' },
        author: { path: 'meta.writer' },
        categories: { path: 'meta.labels[*].name' },
      },
    });

    const { items } = parseOk(API_JSON, config);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'hello',
      title: 'Hello API',
      link: 'https://api.example.com/posts/hello',
      content: '<p>API body</p>',
      author: 'Eve',
      publishedAt: '05/01/2024 14:30',
      categories: ['x', 'y'],
    });
  });

  it('prefers human-facing links and author logins in generic APIs', () => {
    const body = JSON.stringify([
      { url: 'https://api.example.com/r/1', html_url: 'https://example.com/r/1', name: 'v1', author: { login: 'octo', url: 'https://api.example.com/u/octo' } },
    ]);

    const [first] = parseOk(body, parser({ type: 'json', itemsPath: '$[*]' })).items;

    expect(first).toMatchObject({ title: 'v1', link: 'https://example.com/r/1', author: 'octo' });
  });

  it('accepts a path pointing at the array itself', () => {
    const { items } = parseOk(API_JSON, parser({ type: 'json', itemsPath: '$.data.posts' }));

    expect(items.map((i) => i.title)).toEqual(['Hello API', 'Bye API']);
  });

  it.each([
    ['not json', { type: 'json' }, /Invalid JSON/],
    ['{"a":1}', { type: 'json' }, /not a JSON Feed/],
    ['{"a":1}', { type: 'json', itemsPath: '$.missing[*]' }, /matched nothing/],
  ])('reports errors for %s', (body, config, message) => {
    expect(parseError(body, parser(config))).toMatch(message);
  });
});

describe('html parser', () => {
  it('scrapes items with CSS defaults', () => {
    const { items, total, sample } = parseOk(BLOG_HTML, parser({ type: 'html', itemSelector: 'article.post' }));

    expect(total).toBe(2);
    expect(items[0]).toMatchObject({
      title: 'Post one',
      link: '/posts/one',
      summary: 'Excerpt one',
      image: '/images/one.jpg',
      publishedAt: '2024-02-01T10:00:00Z',
    });
    expect(sample).toContain('<article class="post">');
  });

  it('supports explicit selectors, attributes, "." and multi-value categories', () => {
    const config = parser({
      type: 'html',
      itemSelector: 'article.post',
      fields: {
        title: { path: 'h2.title' },
        content: { path: '.', attr: 'html' },
        categories: { path: 'span.tag' },
        author: { path: 'h2 a', attr: 'data-missing' },
      },
    });

    const [first] = parseOk(BLOG_HTML, config).items;

    expect(first?.title).toBe('Post one');
    expect(first?.content).toContain('<h2 class="title">');
    expect(first?.categories).toEqual(['alpha', 'beta']);
    expect(first?.author).toBeUndefined();
  });

  it('uses the item element itself when the field selector matches it', () => {
    const config = parser({ type: 'html', itemSelector: 'h2.title a', fields: { link: { path: 'a', attr: 'href' } } });

    expect(parseOk(BLOG_HTML, config).items[0]?.link).toBe('/posts/one');
  });

  it('scrapes items with XPath', () => {
    const config = parser({
      type: 'html',
      selectorType: 'xpath',
      itemSelector: '//article[@class="post"]',
      fields: {
        title: { path: './/h2' },
        link: { path: './/h2/a/@href' },
        summary: { path: 'string(.//p[@class="excerpt"])' },
        categories: { path: './/span[@class="tag"]' },
        id: { path: 'count(.//span)' },
      },
    });

    const { items, sample } = parseOk(BLOG_HTML, config);

    expect(items[0]).toMatchObject({ title: 'Post one', link: '/posts/one', summary: 'Excerpt one', categories: ['alpha', 'beta'], id: '2' });
    expect(items[1]).toMatchObject({ title: 'Post two', publishedAt: '2024-02-02T10:00:00Z' });
    expect(sample).toContain('Post one');
  });

  it.each([
    [{ type: 'html', itemSelector: 'section.none' }, /matched no elements/],
    [{ type: 'html', itemSelector: 'article[' }, /Invalid CSS selector/],
    [{ type: 'html', selectorType: 'xpath', itemSelector: '//nothing' }, /matched no nodes/],
    [{ type: 'html', selectorType: 'xpath', itemSelector: '//article[' }, /Invalid XPath/],
  ])('reports selector problems %#', (config, message) => {
    expect(parseError(BLOG_HTML, parser(config))).toMatch(message);
  });

  it('discovers advertised feeds and suggests them for non-html sources', () => {
    expect(discoverFeeds(BLOG_HTML, BASE)).toEqual(['https://blog.example.com/feed.xml']);
    expect(parseHint(BLOG_HTML, parser({ type: 'xml' }), BASE)).toMatch(/feed\.xml/);
    expect(parseHint('<!doctype html><p>x</p>', parser({ type: 'json' }), BASE)).toMatch(/HTML source type/);
    expect(parseHint(BLOG_HTML, parser({ type: 'html', itemSelector: 'a' }), BASE)).toBeNull();
    expect(parseHint('{}', parser({ type: 'json' }), BASE)).toBeNull();
  });
});
