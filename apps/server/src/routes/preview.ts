import { previewRequestSchema, rawRequestSchema, type PreviewResult, type RawResult } from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError, parseOrThrow, success } from '../lib/http.js';
import { fetchDocument } from '../pipeline/fetch.js';
import { renderDocument } from '../pipeline/render.js';
import { runPipeline } from '../pipeline/run.js';
import type { RouteContext } from './context.js';

const PREVIEW_MAX_ITEMS = 50;
const RAW_MAX_CHARS = 200_000;

export function registerPreviewRoutes(app: FastifyInstance, ctx: RouteContext): void {
  /** Runs the full pipeline on an unsaved config; nothing is stored. */
  app.post('/preview', async (request) => {
    const { url, config } = parseOrThrow(previewRequestSchema, request.body);
    const result = await runPipeline({ url, config, mode: 'preview' }, ctx.pipeline);
    const preview: PreviewResult = {
      ok: result.status !== 'error',
      items: result.items.slice(0, PREVIEW_MAX_ITEMS),
      diagnostics: result.diagnostics,
      http: result.http,
      sample: result.sample,
      durationMs: result.durationMs,
    };
    return success(preview);
  });

  /** Returns the raw response body, to help writing selectors and paths. */
  app.post('/preview/raw', async (request) => {
    const { url, fetch: options } = parseOrThrow(rawRequestSchema, request.body);
    const document = options.render
      ? await renderDocument(url, options, ctx.pipeline.rendererUrl)
      : await fetchDocument({ url, options, limits: ctx.pipeline.limits, fetchImpl: ctx.pipeline.fetchImpl });
    if (!document.ok) throw new HttpError(502, document.error.message);
    const { body, status, finalUrl, contentType, bytes } = document.value;
    const raw: RawResult = {
      http: { status, finalUrl, contentType, bytes },
      body: body.slice(0, RAW_MAX_CHARS),
      truncated: body.length > RAW_MAX_CHARS,
    };
    return success(raw);
  });
}
