import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, itemsQueryString, unwrapBackup } from './api';
import { changeParserType, draftFromSource, emptyDraft, issuesUnder, previewable, setFieldRule, setIn, validateDraft } from './draft';
import { formatBytes, formatDateTime, formatInterval, hostname, timeAgo } from './format';
import { PRESETS } from './presets';
import { applyTheme, readStored, writeStored } from './storage';

describe('draft helpers', () => {
  it('setIn updates nested values immutably and removes undefined keys', () => {
    const original = { a: { b: 1, c: 2 }, list: [1, 2, 3] };

    const updated = setIn(original, ['a', 'b'], 5);
    const removed = setIn(original, ['a', 'c'], undefined);
    const inArray = setIn(original, ['list', 1], 9);
    const created = setIn({} as Record<string, unknown>, ['x', 'y'], 'z');

    expect(updated).toEqual({ a: { b: 5, c: 2 }, list: [1, 2, 3] });
    expect(removed.a).toEqual({ b: 1 });
    expect(inArray.list).toEqual([1, 9, 3]);
    expect(created).toEqual({ x: { y: 'z' } });
    expect(original.a.b).toBe(1);
  });

  it('validates drafts and reports issues by path', () => {
    const draft = emptyDraft(30);

    const invalid = validateDraft(draft);
    const valid = validateDraft({ ...draft, name: 'Blog', url: 'https://example.com/feed' });

    const unnamed = validateDraft({ ...draft, url: 'https://www.example.com/feed' });
    expect(invalid.ok).toBe(false);
    expect(!invalid.ok && Object.keys(invalid.issues)).toEqual(expect.arrayContaining(['name', 'url']));
    expect(unnamed.ok && unnamed.value.name).toBe('example.com');
    expect(valid.ok && valid.value.refreshIntervalMinutes).toBe(30);
    expect(issuesUnder({ 'config.parser.itemSelector': 'Required', name: 'x' }, 'config.parser')).toEqual(['itemSelector: Required']);
  });

  it('knows when a draft can be previewed', () => {
    const draft = emptyDraft(60);

    expect(previewable(draft)).toBeNull();
    expect(previewable({ ...draft, url: 'https://example.com/rss' })?.url).toBe('https://example.com/rss');
  });

  it('switches parser types and keeps JSONPath rules between xml and json', () => {
    const xml = setFieldRule({ parser: { type: 'xml', fields: {} } }, 'title', { path: 'title.value' });

    const json = changeParserType(xml, 'json');
    const html = changeParserType(json, 'html');

    expect(json.parser).toEqual({ type: 'json', itemsPath: '', fields: { title: { path: 'title.value' } } });
    expect(html.parser).toEqual({ type: 'html', selectorType: 'css', itemSelector: 'article', fields: {} });
    expect(changeParserType(html, 'html')).toBe(html);
    expect(changeParserType(html, 'xml').parser).toEqual({ type: 'xml', fields: {} });
  });

  it('removes a field rule when its path is emptied and drops empty options', () => {
    const config = setFieldRule({ parser: { type: 'html', itemSelector: 'a', fields: {} } }, 'link', { path: 'a', attr: '' });

    expect(config.parser.fields).toEqual({ link: { path: 'a' } });
    expect(setFieldRule(config, 'link', { path: '  ' }).parser.fields).toEqual({});
  });

  it('builds a draft from an existing source', () => {
    const config = PRESETS[3]!.config;
    const draft = draftFromSource({ id: 1, name: 'n', url: 'https://x.test', categoryId: 2, refreshIntervalMinutes: 15, enabled: false, config } as never);

    expect(draft).toMatchObject({ name: 'n', categoryId: 2, enabled: false });
    expect(draft.config).not.toBe(config);
  });

  it('ships presets that are valid configurations', () => {
    for (const preset of PRESETS) {
      expect(validateDraft({ ...emptyDraft(60), name: 'x', url: 'https://x.test', config: preset.config }).ok).toBe(true);
    }
  });
});

describe('format helpers', () => {
  const now = new Date('2024-06-01T12:00:00Z');

  it('formats relative times', () => {
    expect(timeAgo(null)).toBe('never');
    expect(timeAgo('garbage')).toBe('unknown');
    expect(timeAgo('2024-06-01T11:59:50Z', now)).toBe('just now');
    expect(timeAgo('2024-06-01T09:00:00Z', now)).toBe('3 hours ago');
    expect(timeAgo('2024-05-31T12:00:00Z', now)).toBe('yesterday');
  });

  it('formats hosts, sizes, intervals and dates', () => {
    expect(hostname('https://www.example.com/a')).toBe('example.com');
    expect(hostname('nope')).toBe('nope');
    expect(hostname(null)).toBe('');
    expect([formatBytes(10), formatBytes(2048), formatBytes(3 * 1024 * 1024)]).toEqual(['10 B', '2.0 KB', '3.0 MB']);
    expect([formatInterval(30), formatInterval(120), formatInterval(2880)]).toEqual(['30 min', '2 h', '2 d']);
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('2024-01-01T00:00:00Z')).not.toBe('');
  });
});

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('builds item query strings', () => {
    expect(itemsQueryString({ sourceId: 3, unread: true, q: ' rust ' }, 'abc', 10)).toBe('limit=10&sourceId=3&unread=true&q=rust&cursor=abc');
    expect(itemsQueryString({ categoryId: 1, starred: true })).toBe('limit=40&categoryId=1&starred=true');
  });

  it('unwraps the envelope and sends JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: [{ id: 1 }], error: null })));
    vi.stubGlobal('fetch', fetchMock);

    const categories = await api.createCategory('News');

    expect(categories).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/categories', expect.objectContaining({ method: 'POST', body: '{"name":"News"}' }));
  });

  it('throws ApiError with server message and details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, data: null, error: { message: 'Validation failed', details: [{ path: 'url' }] } }), { status: 400 })));

    await expect(api.sources()).rejects.toMatchObject({ message: 'Validation failed', status: 400, details: [{ path: 'url' }] });
  });

  it('reports network failures and non-JSON responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(api.health()).rejects.toBeInstanceOf(ApiError);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(api.health()).rejects.toThrow('Request failed (HTTP 502)');
  });

  it('accepts raw or enveloped backups', () => {
    const backup = { version: 1, categories: [], sources: [] };

    expect(unwrapBackup(backup)).toBe(backup);
    expect(unwrapBackup({ success: true, data: backup })).toBe(backup);
  });
});

describe('storage', () => {
  it('reads, writes and survives broken storage', () => {
    writeStored('k', { a: 1 });
    expect(readStored('k', null)).toEqual({ a: 1 });
    expect(readStored('missing', 'fallback')).toBe('fallback');

    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readStored('k', 'fallback')).toBe('fallback');
    expect(() => writeStored('k', 1)).not.toThrow();
    spy.mockRestore();
    vi.restoreAllMocks();
  });

  it('applies the theme class', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
