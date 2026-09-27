import type { FetchOptions } from '@smart-rss/shared';
import iconv from 'iconv-lite';
import { resolveUrl } from '../lib/html.js';
import { errorMessage, ok, pipelineErr, type Result } from '../lib/result.js';
import { DEFAULT_USER_AGENT, type FetchedDocument, type FetchImpl, type FetchLimits } from './types.js';

const ACCEPT =
  'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, ' +
  'application/json;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CHARSET_SNIFF_BYTES = 2048;

export interface FetchRequest {
  url: string;
  options: FetchOptions;
  limits: FetchLimits;
  etag?: string | null;
  lastModified?: string | null;
  fetchImpl?: FetchImpl;
}

function buildHeaders(request: FetchRequest): Headers {
  const headers = new Headers({ accept: ACCEPT, 'user-agent': request.options.userAgent || DEFAULT_USER_AGENT });
  if (request.etag) headers.set('if-none-match', request.etag);
  if (request.lastModified) headers.set('if-modified-since', request.lastModified);
  for (const [name, value] of Object.entries(request.options.headers)) headers.set(name, value);
  return headers;
}

function describeFetchError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return `Timed out after ${timeoutMs} ms`;
  }
  return `Network error: ${errorMessage(error)}`;
}

export function detectCharset(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  const head = Buffer.from(bytes.subarray(0, CHARSET_SNIFF_BYTES)).toString('latin1');
  const declared =
    /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  return declared?.toLowerCase() ?? 'utf-8';
}

export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const charset = detectCharset(bytes, contentType);
  return iconv.decode(Buffer.from(bytes), iconv.encodingExists(charset) ? charset : 'utf-8');
}

async function readLimited(response: Response, maxBytes: number, timeoutMs: number): Promise<Result<Uint8Array>> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel();
    return pipelineErr('fetch', `Response too large (${declared} bytes, limit ${maxBytes})`);
  }
  if (!response.body) return ok(new Uint8Array());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return pipelineErr('fetch', `Response too large (limit ${maxBytes} bytes)`);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    return pipelineErr('fetch', describeFetchError(error, timeoutMs), error);
  }
  return ok(Buffer.concat(chunks));
}

async function toDocument(response: Response, url: string, request: FetchRequest): Promise<Result<FetchedDocument>> {
  const common = {
    status: response.status,
    finalUrl: url,
    contentType: response.headers.get('content-type'),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
  if (response.status === 304) {
    await response.body?.cancel();
    return ok({ ...common, body: '', bytes: 0, notModified: true });
  }
  if (!response.ok) {
    await response.body?.cancel();
    return pipelineErr('fetch', `HTTP ${response.status} ${response.statusText}`.trim());
  }
  const bytes = await readLimited(response, request.limits.maxBytes, request.options.timeoutMs);
  if (!bytes.ok) return bytes;
  return ok({
    ...common,
    body: decodeBody(bytes.value, common.contentType),
    bytes: bytes.value.byteLength,
    notModified: false,
  });
}

/** Fetches a URL with timeout, size cap, manual redirect handling and conditional GET. */
export async function fetchDocument(request: FetchRequest): Promise<Result<FetchedDocument>> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(request.options.timeoutMs);
  const headers = buildHeaders(request);
  let url = request.url;
  let method = request.options.method;
  let body = method === 'POST' ? request.options.body : undefined;

  for (let redirects = 0; ; redirects++) {
    let response: Response;
    try {
      response = await fetchImpl(url, { method, headers, body, redirect: 'manual', signal });
    } catch (error) {
      return pipelineErr('fetch', describeFetchError(error, request.options.timeoutMs), error);
    }
    if (!REDIRECT_STATUSES.has(response.status)) return toDocument(response, url, request);

    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) return pipelineErr('fetch', `HTTP ${response.status} redirect without Location header`);
    if (redirects >= request.limits.maxRedirects) {
      return pipelineErr('fetch', `Too many redirects (limit ${request.limits.maxRedirects})`);
    }
    const next = resolveUrl(location, url);
    if (!next) return pipelineErr('fetch', `Redirect to unsupported URL: ${location}`);
    url = next;
    if (response.status === 303 || (method === 'POST' && response.status <= 302)) {
      method = 'GET';
      body = undefined;
    }
  }
}
