import { ITEM_FIELDS, type FieldMap } from '@smart-rss/shared';
import { JSONPath } from 'jsonpath-plus';
import type { MappedItem } from './types.js';

export type JsonRecord = Record<string, unknown>;

/** A JSONPath expression, or a function for defaults that JSONPath cannot express. */
export type Extractor = string | ((item: JsonRecord) => unknown);
export type DefaultMap = Partial<Record<keyof MappedItem, Extractor[]>>;

const TEXT_KEYS = ['value', '#text', 'name', 'term', 'label', 'url', 'href', 'text'];

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Evaluates a JSONPath against a value. Throws on invalid expressions. */
export function queryPath(json: unknown, path: string): unknown[] {
  if (typeof json !== 'object' || json === null) return [];
  const result = JSONPath({ path, json, wrap: true, eval: 'safe' }) as unknown;
  return Array.isArray(result) ? result : [];
}

/** Best-effort conversion of a parsed value to a string. */
export function toText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = toText(entry);
      if (text) return text;
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const key of TEXT_KEYS) {
      const text = toText(value[key]);
      if (text) return text;
    }
  }
  return undefined;
}

export function toTextList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(toTextList);
  const text = toText(value);
  return text ? [text] : [];
}

function evaluate(item: JsonRecord, extractor: Extractor): unknown[] {
  return typeof extractor === 'function' ? [extractor(item)] : queryPath(item, extractor);
}

/** Maps a parsed object to raw item fields: user rules first, defaults otherwise (first non-empty wins). */
export function mapObject(item: JsonRecord, defaults: DefaultMap, fields: FieldMap): MappedItem {
  const entries = ITEM_FIELDS.map((field) => {
    const rule = fields[field];
    const extractors: Extractor[] = rule ? [rule.path] : (defaults[field] ?? []);
    for (const extractor of extractors) {
      const values = evaluate(item, extractor);
      if (field === 'categories') {
        const list = values.flatMap(toTextList).map((v) => v.trim()).filter(Boolean);
        if (list.length > 0) return [field, list] as const;
      } else {
        const text = toText(values)?.trim();
        if (text) return [field, text] as const;
      }
    }
    return [field, undefined] as const;
  }).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as MappedItem;
}
