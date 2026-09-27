import type { FetchOptions } from '@smart-rss/shared';
import { errorMessage, ok, pipelineErr, type Result } from '../lib/result.js';
import { DEFAULT_USER_AGENT, type FetchedDocument } from './types.js';

const PROBE_TIMEOUT_MS = 2000;

export const RENDERER_MISSING_MESSAGE =
  'JavaScript rendering requires the renderer service (start it with: docker compose --profile js up -d)';

/** Loads a page in headless Chromium (browserless over CDP) and returns the rendered HTML. */
export async function renderDocument(
  url: string,
  options: FetchOptions,
  rendererUrl: string | null,
): Promise<Result<FetchedDocument>> {
  if (!rendererUrl) return pipelineErr('fetch', RENDERER_MISSING_MESSAGE);
  const { chromium } = await import('playwright-core');
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  try {
    browser = await chromium.connectOverCDP(rendererUrl, { timeout: options.timeoutMs });
    const context = await browser.newContext({
      userAgent: options.userAgent || DEFAULT_USER_AGENT,
      extraHTTPHeaders: options.headers,
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: options.timeoutMs });
    const status = response?.status() ?? 200;
    if (status >= 400) return pipelineErr('fetch', `HTTP ${status} (rendered)`);
    const body = await page.content();
    return ok({
      status,
      finalUrl: page.url(),
      contentType: 'text/html; charset=utf-8',
      body,
      bytes: Buffer.byteLength(body),
      etag: null,
      lastModified: null,
      notModified: false,
    });
  } catch (error) {
    return pipelineErr('fetch', `Rendering failed: ${errorMessage(error)}`, error);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** Checks whether the renderer answers on its HTTP endpoint. */
export async function probeRenderer(rendererUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const url = new URL(rendererUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/json/version';
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}
