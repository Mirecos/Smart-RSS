import type { ItemField } from '@smart-rss/shared';

/** Upper bound of items processed per fetch. */
export const MAX_ITEMS_PER_FETCH = 200;
/** Max length of the raw item sample returned to the source editor. */
export const SAMPLE_MAX_CHARS = 8000;

export const DEFAULT_USER_AGENT = 'SmartRSS/0.1 (self-hosted feed aggregator)';

export type FetchImpl = typeof fetch;

export interface FetchLimits {
  maxBytes: number;
  maxRedirects: number;
}

export interface FetchedDocument {
  status: number;
  finalUrl: string;
  contentType: string | null;
  body: string;
  bytes: number;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
}

/** Raw string values extracted for one item, before transforms and normalization. */
export type MappedItem = { [K in Exclude<ItemField, 'categories'>]?: string } & { categories?: string[] };

export interface ParseOutput {
  items: MappedItem[];
  /** Number of items found in the document (may exceed items.length). */
  total: number;
  sample: string | null;
}

export function truncateSample(value: string): string {
  return value.length > SAMPLE_MAX_CHARS ? `${value.slice(0, SAMPLE_MAX_CHARS)}\n…` : value;
}
