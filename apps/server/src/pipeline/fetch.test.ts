import { fetchOptionsSchema } from '@smart-rss/shared';
import iconv from 'iconv-lite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../../test/fixture-server.js';
import { decodeBody, detectCharset, fetchDocument, type FetchRequest } from './fetch.js';

const limits = { maxBytes: 1024 * 1024, maxRedirects: 2 };

describe('fetchDocument', () => {
  let server: FixtureServer;
  const request = (path: string, extra: Partial<FetchRequest> = {}): FetchRequest => ({
    url: `${server.url}${path}`,
    options: fetchOptionsSchema.parse({ timeoutMs: 1000 }),
    limits,
    ...extra,
  });

  beforeAll(async () => {
    server = await startFixtureServer({
      '/ok': { body: 'hello', headers: { 'content-type': 'text/plain', etag: '"v1"', 'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT' } },
      '/not-modified': {
        handler: (req, res) => {
          if (req.headers['if-none-match'] === '"v1"') res.writeHead(304).end();
          else res.writeHead(200, { etag: '"v1"' }).end('fresh');
        },
      },
      '/missing': { status: 404 },
      '/r1': { status: 302, headers: { location: '/r2' } },
      '/r2': { status: 301, headers: { location: '/ok' } },
      '/loop': { status: 302, headers: { location: '/loop' } },
      '/no-location': { status: 302 },
      '/bad-scheme': { status: 302, headers: { location: 'ftp://example.com/file' } },
      '/slow': { delayMs: 1500, body: 'late' },
      '/big': { body: 'x'.repeat(2048) },
      '/big-declared': { headers: { 'content-length': '999999999' }, handler: (_req, res) => res.writeHead(200, { 'content-length': '5000000' }).end() },
      '/latin1': { body: iconv.encode('<?xml version="1.0" encoding="ISO-8859-1"?><t>café</t>', 'latin1'), headers: { 'content-type': 'application/xml' } },
      '/echo': { handler: (req, res) => res.writeHead(200).end(JSON.stringify({ ua: req.headers['user-agent'], x: req.headers['x-token'], method: req.method })) },
      '/post-redirect': { status: 303, headers: { location: '/echo' } },
    });
  });

  afterAll(() => server.close());

  it('returns body, status and cache validators', async () => {
    const result = await fetchDocument(request('/ok'));

    expect(result.ok && result.value).toMatchObject({
      status: 200,
      body: 'hello',
      bytes: 5,
      etag: '"v1"',
      lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT',
      notModified: false,
    });
  });

  it('sends conditional headers and reports 304 as not modified', async () => {
    const result = await fetchDocument(request('/not-modified', { etag: '"v1"' }));

    expect(result.ok && result.value.notModified).toBe(true);
  });

  it('fails on HTTP errors', async () => {
    const result = await fetchDocument(request('/missing'));

    expect(!result.ok && result.error.message).toMatch(/HTTP 404/);
  });

  it('follows redirects and exposes the final url', async () => {
    const result = await fetchDocument(request('/r1'));

    expect(result.ok && result.value.finalUrl).toBe(`${server.url}/ok`);
  });

  it.each([
    ['/loop', /Too many redirects/],
    ['/no-location', /without Location/],
    ['/bad-scheme', /unsupported URL/],
  ])('rejects bad redirect %s', async (path, message) => {
    const result = await fetchDocument(request(path));

    expect(!result.ok && result.error.message).toMatch(message);
  });

  it('times out slow responses', async () => {
    const result = await fetchDocument(request('/slow'));

    expect(!result.ok && result.error.message).toMatch(/Timed out after 1000 ms/);
  });

  it('enforces the response size limit while streaming and from content-length', async () => {
    const streamed = await fetchDocument(request('/big', { limits: { ...limits, maxBytes: 1000 } }));
    const declared = await fetchDocument(request('/big-declared'));

    expect(!streamed.ok && streamed.error.message).toMatch(/too large/);
    expect(!declared.ok && declared.error.message).toMatch(/too large/);
  });

  it('decodes non-UTF-8 documents using the XML declaration', async () => {
    const result = await fetchDocument(request('/latin1'));

    expect(result.ok && result.value.body).toContain('café');
  });

  it('sends custom headers, user agent and switches POST to GET on 303', async () => {
    const options = fetchOptionsSchema.parse({ method: 'POST', body: '{}', userAgent: 'TestAgent', headers: { 'X-Token': 'abc' } });

    const result = await fetchDocument(request('/post-redirect', { options }));

    expect(result.ok && JSON.parse(result.value.body)).toEqual({ ua: 'TestAgent', x: 'abc', method: 'GET' });
  });

  it('reports network errors', async () => {
    const result = await fetchDocument({ ...request('/ok'), url: 'http://127.0.0.1:1/' });

    expect(!result.ok && result.error.message).toMatch(/Network error/);
  });
});

describe('charset detection', () => {
  const bytes = (text: string) => Buffer.from(text, 'latin1');

  it('prefers the content-type header', () => {
    expect(detectCharset(bytes('<?xml encoding="utf-8"?>'), 'text/xml; charset=ISO-8859-1')).toBe('iso-8859-1');
  });

  it('detects BOMs and meta tags', () => {
    expect(detectCharset(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41]), null)).toBe('utf-8');
    expect(detectCharset(Uint8Array.from([0xff, 0xfe]), null)).toBe('utf-16le');
    expect(detectCharset(bytes('<html><meta charset="windows-1252">'), null)).toBe('windows-1252');
    expect(detectCharset(bytes('<html>'), null)).toBe('utf-8');
  });

  it('falls back to utf-8 for unknown encodings', () => {
    expect(decodeBody(Buffer.from('ok'), 'text/plain; charset=made-up')).toBe('ok');
  });
});
