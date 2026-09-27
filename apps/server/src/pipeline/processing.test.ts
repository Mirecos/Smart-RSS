import { filterSchema, transformSchema, type ParsedItem } from '@smart-rss/shared';
import { describe, expect, it } from 'vitest';
import { applyFilters, compileFilters } from './filters.js';
import { normalizeItem, parseDate, type NormalizeContext } from './normalize.js';
import { sanitizeContent, sanitizeItem } from './sanitize.js';
import { applyTransforms, compileTransforms } from './transforms.js';

const NOW = new Date('2024-06-01T00:00:00Z');
const ctx: NormalizeContext = { baseUrl: 'https://site.example.com/list', dedupeBy: 'guid', now: NOW };

const item = (overrides: Partial<ParsedItem> = {}): ParsedItem => ({
  guid: 'g',
  title: 'Breaking: rust 2.0 released',
  link: 'https://site.example.com/a',
  content: '<p>Sponsored content about gardening</p>',
  summary: null,
  author: 'Ann',
  image: null,
  categories: [],
  publishedAt: null,
  ...overrides,
});

describe('transforms', () => {
  it('applies transforms in order without mutating input', () => {
    const transforms = [
      { op: 'regexReplace', field: 'title', pattern: '^\\[AD\\]\\s*', replacement: '' },
      { op: 'truncate', field: 'title', length: 5 },
      { op: 'stripHtml', field: 'content' },
      { op: 'trim', field: 'summary' },
      { op: 'defaultValue', field: 'author', value: 'Staff' },
      { op: 'regexReplace', field: 'publishedAt', pattern: '^Posted on ', flags: 'i' },
    ].map((t) => transformSchema.parse(t));
    const compiled = compileTransforms(transforms);
    const input = { title: '[AD] Hello world', content: '<b>Bold</b> &amp; text', summary: '  a \n b  ', publishedAt: 'posted on 2024-01-01' };

    const [output] = applyTransforms([input], compiled.ok ? compiled.value : []);

    expect(output).toEqual({ title: 'Hello…', content: 'Bold & text', summary: 'a b', author: 'Staff', publishedAt: '2024-01-01' });
    expect(input.title).toBe('[AD] Hello world');
  });

  it('never truncates long values when applying a regex', () => {
    const compiled = compileTransforms([transformSchema.parse({ op: 'regexReplace', field: 'content', pattern: '^AD ' })]);
    const long = `AD ${'x'.repeat(150_000)}END`;

    const [output] = applyTransforms([{ content: long }], compiled.ok ? compiled.value : []);

    expect(output?.content).toHaveLength(long.length - 3);
    expect(output?.content?.endsWith('END')).toBe(true);
  });

  it('reports invalid regexes instead of throwing', () => {
    const result = compileTransforms([{ op: 'regexReplace', field: 'title', pattern: '(', flags: 'g', replacement: '' }]);

    expect(!result.ok && result.error.stage).toBe('transform');
  });
});

describe('parseDate', () => {
  it.each([
    ['2024-01-02T03:04:05Z', undefined, '2024-01-02T03:04:05.000Z'],
    ['Mon, 01 Jan 2024 10:00:00 GMT', undefined, '2024-01-01T10:00:00.000Z'],
    ['Tue, 02 Jan 2024 10:00:00 CEST', undefined, '2024-01-02T08:00:00.000Z'],
    ['1704067200', undefined, '2024-01-01T00:00:00.000Z'],
    ['1704067200000', undefined, '2024-01-01T00:00:00.000Z'],
    ['not a date', undefined, null],
    ['Mon, 01 Jan 2024 10:00:00 XYZ', undefined, null],
    ['', undefined, null],
    ['31/12/2023', 'dd/MM/yyyy', new Date(2023, 11, 31).toISOString()],
    ['2023-12-31', 'dd/MM/yyyy', null],
  ])('parses %s (format %s)', (value, format, expected) => {
    expect(parseDate(value, format, NOW)).toBe(expected);
  });
});

describe('normalizeItem', () => {
  it('resolves urls, decodes titles, drops duplicate summary and dedupes by guid', () => {
    const result = normalizeItem(
      { id: ' post-1 ', title: 'A &amp; <b>B</b>', link: '/a', content: '<p>x</p>', summary: '<p>x</p>', image: 'img.png', categories: ['One', 'One', ' '], author: '<i>Ann</i>' },
      ctx,
    );

    expect(result.ok && result.value.item).toEqual({
      guid: 'post-1',
      title: 'A & B',
      link: 'https://site.example.com/a',
      content: '<p>x</p>',
      summary: null,
      author: 'Ann',
      image: 'https://site.example.com/img.png',
      categories: ['One'],
      publishedAt: null,
    });
  });

  it('builds a fallback title and flags invalid dates', () => {
    const result = normalizeItem({ summary: `<p>${'word '.repeat(40)}</p>`, publishedAt: 'yesterday-ish' }, ctx);

    expect(result.ok && result.value.item.title).toMatch(/^word word .*…$/);
    expect(result.ok && result.value.invalidDate).toBe(true);
  });

  it('uses the configured dedupe strategy', () => {
    const raw = { id: 'id-1', title: 'Same Title', link: 'https://x.example.com/1' };

    const byLink = normalizeItem(raw, { ...ctx, dedupeBy: 'link' });
    const byTitle = normalizeItem({ ...raw, title: 'same title' }, { ...ctx, dedupeBy: 'titleHash' });
    const byTitle2 = normalizeItem(raw, { ...ctx, dedupeBy: 'titleHash' });
    const noId = normalizeItem({ title: 'T' }, ctx);

    expect(byLink.ok && byLink.value.item.guid).toBe('https://x.example.com/1');
    expect(byTitle.ok && byTitle2.ok && byTitle.value.item.guid === byTitle2.value.item.guid).toBe(true);
    expect(noId.ok && noId.value.item.guid).toMatch(/^[0-9a-f]{40}$/);
  });

  it('rejects empty items and ignores non-http links', () => {
    expect(normalizeItem({}, ctx).ok).toBe(false);
    const result = normalizeItem({ title: 'x', link: 'javascript:alert(1)' }, ctx);
    expect(result.ok && result.value.item.link).toBeNull();
  });
});

describe('filters', () => {
  const compile = (filters: unknown[]) => {
    const compiled = compileFilters(filters.map((f) => filterSchema.parse(f)));
    if (!compiled.ok) throw compiled.error;
    return compiled.value;
  };

  it('keeps items matching an include and drops excludes', () => {
    const items = [item({ guid: '1' }), item({ guid: '2', title: 'Weather today' }), item({ guid: '3', title: 'Rust tips', content: null })];
    const filters = compile([
      { mode: 'include', field: 'title', pattern: 'rust' },
      { mode: 'exclude', field: 'content', pattern: 'sponsored' },
    ]);

    expect(applyFilters(items, filters).map((i) => i.guid)).toEqual(['3']);
  });

  it('matches against all fields with "any" and ignores the g flag', () => {
    const filters = compile([{ mode: 'include', pattern: 'ann', flags: 'gi' }]);
    const items = [item({ guid: '1' }), item({ guid: '2' })];

    expect(applyFilters(items, filters)).toHaveLength(2);
    expect(applyFilters(items, [])).toBe(items);
  });

  it('reports invalid patterns', () => {
    const result = compileFilters([{ mode: 'include', field: 'any', pattern: '[', flags: '' }]);

    expect(!result.ok && result.error.stage).toBe('filter');
  });
});

describe('sanitize', () => {
  it('removes scripts, handlers and dangerous urls', () => {
    const html = '<p onclick="x()">Hi<script>alert(1)</script><a href="javascript:alert(1)">bad</a><iframe src="https://evil"></iframe></p>';

    const clean = sanitizeContent(html, 'https://site.example.com/');

    expect(clean).not.toMatch(/script|onclick|javascript|iframe/);
    expect(clean).toContain('<p>Hi');
  });

  it('absolutizes links and images and hardens anchors', () => {
    const clean = sanitizeContent('<a href="/x">x</a><img data-src="/i.png"><img><a href="mailto:a@b.c">m</a>', 'https://site.example.com/p/');

    expect(clean).toContain('href="https://site.example.com/x"');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
    expect(clean).toContain('src="https://site.example.com/i.png"');
    expect(clean).toContain('href="mailto:a@b.c"');
    expect(clean.match(/<img/g)).toHaveLength(1);
  });

  it('sanitizes item content and summary relative to the item link', () => {
    const result = sanitizeItem(item({ content: '<img src="pic.png">', summary: '<script></script>' }), 'https://fallback.example.com/');

    expect(result.content).toContain('https://site.example.com/pic.png');
    expect(result.summary).toBeNull();
  });
});
