import type {
  Diagnostic,
  HttpInfo,
  ParsedItem,
  PipelineStage,
  SourceConfig,
} from '@smart-rss/shared';
import pLimit from 'p-limit';
import { ok, type PipelineError, type Result } from '../lib/result.js';
import { fetchDocument } from './fetch.js';
import { applyFilters, compileFilters } from './filters.js';
import { extractFullText } from './fulltext.js';
import { normalizeItem, type NormalizeContext } from './normalize.js';
import { parseDocument, parseHint } from './parsers/index.js';
import { renderDocument } from './render.js';
import { sanitizeItem } from './sanitize.js';
import { applyTransforms, compileTransforms } from './transforms.js';
import {
  MAX_ITEMS_PER_FETCH,
  type FetchedDocument,
  type FetchImpl,
  type FetchLimits,
  type ParseOutput,
} from './types.js';

const FULLTEXT_CONCURRENCY = 3;
const FULLTEXT_PREVIEW_LIMIT = 3;
const FULLTEXT_RUN_LIMIT = 20;

export interface PipelineDeps {
  limits: FetchLimits;
  rendererUrl: string | null;
  fetchImpl?: FetchImpl;
  now?: () => Date;
}

export interface PipelineInput {
  url: string;
  config: SourceConfig;
  mode: 'preview' | 'scheduled';
  etag?: string | null;
  lastModified?: string | null;
  /** Returns the subset of guids already stored (full text is only fetched for new items). */
  knownGuids?: (guids: string[]) => Set<string>;
}

export interface PipelineResult {
  status: 'ok' | 'not_modified' | 'error';
  items: ParsedItem[];
  diagnostics: Diagnostic[];
  http: HttpInfo;
  validators: { etag: string | null; lastModified: string | null };
  sample: string | null;
  durationMs: number;
  error: string | null;
}

interface Staged {
  items: ParsedItem[];
  diagnostics: Diagnostic[];
}

const diag = (stage: PipelineStage, level: Diagnostic['level'], message: string): Diagnostic => ({
  stage,
  level,
  message,
});

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function fetchStage(input: PipelineInput, deps: PipelineDeps): Promise<Result<FetchedDocument>> {
  const { fetch: options } = input.config;
  if (options.render) return renderDocument(input.url, options, deps.rendererUrl);
  const conditional = input.mode === 'scheduled' ? { etag: input.etag, lastModified: input.lastModified } : {};
  return fetchDocument({ url: input.url, options, limits: deps.limits, fetchImpl: deps.fetchImpl, ...conditional });
}

function normalizeStage(parsed: ParseOutput, config: SourceConfig, ctx: NormalizeContext): Result<Staged> {
  const transforms = compileTransforms(config.transforms);
  if (!transforms.ok) return transforms;
  const items: ParsedItem[] = [];
  let dropped = 0;
  let invalidDates = 0;
  for (const raw of applyTransforms(parsed.items, transforms.value)) {
    const normalized = normalizeItem(raw, ctx);
    if (!normalized.ok) dropped++;
    else {
      items.push(normalized.value.item);
      if (normalized.value.invalidDate) invalidDates++;
    }
  }
  const diagnostics: Diagnostic[] = [];
  if (dropped > 0) diagnostics.push(diag('normalize', 'warning', `${plural(dropped, 'item')} skipped: no title, link or content`));
  if (invalidDates > 0) {
    const hint = ctx.dateFormat
      ? `with format "${ctx.dateFormat}"`
      : '(set a date format on the publishedAt field)';
    diagnostics.push(diag('normalize', 'warning', `${plural(invalidDates, 'item')} with an unparseable date ${hint}`));
  }
  return ok({ items, diagnostics });
}

function filterAndDedupeStage(staged: Staged, config: SourceConfig): Result<Staged> {
  const filters = compileFilters(config.filters);
  if (!filters.ok) return filters;
  const diagnostics = [...staged.diagnostics];
  const kept = applyFilters(staged.items, filters.value);
  if (config.filters.length > 0) {
    diagnostics.push(diag('filter', 'info', `Filters kept ${kept.length} of ${staged.items.length} items`));
  }
  const unique = [...new Map(kept.map((item) => [item.guid, item] as const)).values()];
  if (unique.length < kept.length) {
    const merged = kept.length - unique.length;
    diagnostics.push(diag('dedupe', 'warning', `${plural(merged, 'duplicate item')} merged (same ${config.dedupeBy})`));
  }
  return ok({ items: unique, diagnostics });
}

async function fullTextStage(staged: Staged, input: PipelineInput, deps: PipelineDeps): Promise<Staged> {
  const { fullText } = input.config;
  if (fullText.mode === 'off') return staged;
  const known = input.knownGuids?.(staged.items.map((item) => item.guid)) ?? new Set<string>();
  const candidates = staged.items
    .filter((item) => item.link && !known.has(item.guid))
    .slice(0, input.mode === 'preview' ? FULLTEXT_PREVIEW_LIMIT : FULLTEXT_RUN_LIMIT);
  const limit = pLimit(FULLTEXT_CONCURRENCY);
  const extracted = await Promise.all(
    candidates.map((item) =>
      limit(async () => [item.guid, await extractFullText(item.link as string, fullText, { fetchOptions: input.config.fetch, limits: deps.limits, fetchImpl: deps.fetchImpl })] as const),
    ),
  );
  const contents = new Map(extracted.flatMap(([guid, result]) => (result.ok ? [[guid, result.value] as const] : [])));
  const failures = extracted.flatMap(([, result]) => (result.ok ? [] : [result.error.message]));
  const diagnostics = [...staged.diagnostics];
  if (candidates.length > 0) {
    diagnostics.push(diag('fulltext', 'info', `Full text extracted for ${contents.size} of ${candidates.length} items`));
  }
  if (failures.length > 0) {
    diagnostics.push(diag('fulltext', 'warning', `${plural(failures.length, 'extraction')} failed, e.g. ${failures[0]}`));
  }
  const items = staged.items.map((item) => (contents.has(item.guid) ? { ...item, content: contents.get(item.guid) ?? null } : item));
  return { items, diagnostics };
}

/** Runs fetch → parse → transform → normalize → filter → dedupe → full text → sanitize. */
export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const started = performance.now();
  const empty: PipelineResult = {
    status: 'error', items: [], diagnostics: [], sample: null, durationMs: 0, error: null,
    http: { status: null, finalUrl: null, contentType: null, bytes: 0 },
    validators: { etag: null, lastModified: null },
  };
  const finish = (partial: Partial<PipelineResult>): PipelineResult => ({
    ...empty,
    ...partial,
    durationMs: Math.round(performance.now() - started),
  });
  const fail = (error: PipelineError, before: Diagnostic[], extra: Partial<PipelineResult> = {}, after: Diagnostic[] = []) =>
    finish({ ...extra, status: 'error', error: error.message, diagnostics: [...before, diag(error.stage, 'error', error.message), ...after] });

  const fetched = await fetchStage(input, deps);
  if (!fetched.ok) return fail(fetched.error, []);
  const doc = fetched.value;
  const http: HttpInfo = { status: doc.status, finalUrl: doc.finalUrl, contentType: doc.contentType, bytes: doc.bytes };
  const validators = { etag: doc.etag, lastModified: doc.lastModified };
  if (doc.notModified) {
    return finish({ status: 'not_modified', http, validators, diagnostics: [diag('fetch', 'info', 'Not modified since last fetch (HTTP 304)')] });
  }
  const diagnostics = [diag('fetch', 'info', `HTTP ${doc.status} · ${(doc.bytes / 1024).toFixed(1)} KB · ${doc.contentType ?? 'no content type'}`)];

  const parsed = parseDocument(doc.body, input.config.parser, doc.finalUrl);
  if (!parsed.ok) {
    const hint = parseHint(doc.body, input.config.parser, doc.finalUrl);
    return fail(parsed.error, diagnostics, { http }, hint ? [diag('parse', 'info', hint)] : []);
  }
  const { total, sample } = parsed.value;
  const capped = total > MAX_ITEMS_PER_FETCH ? ` (only the first ${MAX_ITEMS_PER_FETCH} are processed)` : '';
  diagnostics.push(diag('parse', total === 0 ? 'warning' : 'info', `Found ${plural(total, 'item')}${capped}`));

  const ctx: NormalizeContext = {
    baseUrl: doc.finalUrl,
    dateFormat: input.config.parser.fields.publishedAt?.dateFormat,
    dedupeBy: input.config.dedupeBy,
    now: deps.now?.() ?? new Date(),
  };
  const normalized = normalizeStage(parsed.value, input.config, ctx);
  if (!normalized.ok) return fail(normalized.error, diagnostics, { http, sample });
  const filtered = filterAndDedupeStage({ ...normalized.value, diagnostics: [...diagnostics, ...normalized.value.diagnostics] }, input.config);
  if (!filtered.ok) return fail(filtered.error, diagnostics, { http, sample });

  const enriched = await fullTextStage(filtered.value, input, deps);
  const items = enriched.items.map((item) => sanitizeItem(item, doc.finalUrl));
  return finish({ status: 'ok', items, diagnostics: enriched.diagnostics, http, validators, sample });
}
