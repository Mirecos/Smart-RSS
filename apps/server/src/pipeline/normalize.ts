import type { ParsedItem, SourceConfig } from '@smart-rss/shared';
import { isValid, parse } from 'date-fns';
import { sha1 } from '../lib/hash.js';
import { htmlToText, resolveUrl } from '../lib/html.js';
import { err, ok, type Result } from '../lib/result.js';
import type { MappedItem } from './types.js';

const MAX_TITLE = 1000;
const MAX_AUTHOR = 200;
const MAX_GUID = 500;
const MAX_CATEGORIES = 20;
const MAX_CATEGORY_LENGTH = 100;
const FALLBACK_TITLE_LENGTH = 80;

/** Common timezone abbreviations that JavaScript's Date parser does not understand. */
const TZ_OFFSETS: Record<string, string> = {
  UT: '+0000', UTC: '+0000', GMT: '+0000', Z: '+0000',
  EST: '-0500', EDT: '-0400', CST: '-0600', CDT: '-0500', MST: '-0700', MDT: '-0600',
  PST: '-0800', PDT: '-0700', CET: '+0100', CEST: '+0200', BST: '+0100', IST: '+0530',
  JST: '+0900', AEST: '+1000', AEDT: '+1100',
};

export interface NormalizeContext {
  baseUrl: string;
  dateFormat?: string;
  dedupeBy: SourceConfig['dedupeBy'];
  now: Date;
}

export interface NormalizedItem {
  item: ParsedItem;
  invalidDate: boolean;
}

const nonEmpty = (value: string | undefined): string | null => (value?.trim() ? value.trim() : null);

function fromNativeDate(value: string): Date | null {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const zone = /\s([A-Z]{1,4})$/.exec(value)?.[1];
  const offset = zone ? TZ_OFFSETS[zone] : undefined;
  if (!offset) return null;
  const retried = new Date(value.replace(/\s[A-Z]{1,4}$/, ` ${offset}`));
  return Number.isNaN(retried.getTime()) ? null : retried;
}

/** Parses a date string to ISO 8601; returns null when it cannot be understood. */
export function parseDate(value: string | undefined, format: string | undefined, now: Date): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (format) {
    const parsed = parse(text, format, now);
    return isValid(parsed) ? parsed.toISOString() : null;
  }
  if (/^\d{9,13}$/.test(text)) {
    const epoch = Number(text);
    return new Date(text.length <= 10 ? epoch * 1000 : epoch).toISOString();
  }
  return fromNativeDate(text)?.toISOString() ?? null;
}

function computeGuid(ctx: NormalizeContext, id: string | null, link: string | null, title: string, content: string | null) {
  const contentKey = sha1(title, content);
  switch (ctx.dedupeBy) {
    case 'link':
      return link ?? id ?? contentKey;
    case 'titleHash':
      return sha1(title.toLowerCase());
    case 'guid':
      return id ?? link ?? contentKey;
  }
}

function fallbackTitle(content: string | null, summary: string | null, link: string | null): string {
  const text = htmlToText(summary ?? content ?? '');
  if (text) return text.length > FALLBACK_TITLE_LENGTH ? `${text.slice(0, FALLBACK_TITLE_LENGTH).trimEnd()}…` : text;
  return link ?? '(untitled)';
}

function normalizeCategories(values: string[] | undefined): string[] {
  const cleaned = (values ?? []).map((v) => htmlToText(v).slice(0, MAX_CATEGORY_LENGTH)).filter(Boolean);
  return [...new Set(cleaned)].slice(0, MAX_CATEGORIES);
}

/** Turns raw extracted strings into a clean item. Fails when there is nothing to show. */
export function normalizeItem(raw: MappedItem, ctx: NormalizeContext): Result<NormalizedItem, string> {
  const link = resolveUrl(raw.link, ctx.baseUrl);
  const content = nonEmpty(raw.content);
  const rawSummary = nonEmpty(raw.summary);
  const summary = rawSummary && rawSummary !== content ? rawSummary : null;
  const titleText = raw.title ? htmlToText(raw.title) : '';
  if (!titleText && !link && !content && !summary) return err('Item has no title, link or content');

  const title = (titleText || fallbackTitle(content, summary, link)).slice(0, MAX_TITLE);
  const publishedAt = parseDate(raw.publishedAt, ctx.dateFormat, ctx.now);
  const author = raw.author ? htmlToText(raw.author).slice(0, MAX_AUTHOR) || null : null;
  const id = nonEmpty(raw.id)?.slice(0, MAX_GUID) ?? null;

  return ok({
    item: {
      guid: computeGuid(ctx, id, link, title, content),
      title,
      link,
      content,
      summary,
      author,
      image: resolveUrl(raw.image, link ?? ctx.baseUrl),
      categories: normalizeCategories(raw.categories),
      publishedAt,
    },
    invalidDate: Boolean(raw.publishedAt?.trim()) && publishedAt === null,
  });
}
