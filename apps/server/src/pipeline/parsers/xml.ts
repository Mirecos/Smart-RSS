import type { FieldMap, XmlParserConfig } from '@smart-rss/shared';
import { parseFeed, type AnyFeed } from 'feedsmith';
import { errorMessage, ok, pipelineErr, type Result } from '../../lib/result.js';
import { MAX_ITEMS_PER_FETCH, truncateSample, type ParseOutput } from '../types.js';
import { isRecord, mapObject, type DefaultMap, type JsonRecord } from '../values.js';
import { ATOM_DEFAULTS, JSON_FEED_DEFAULTS, RDF_DEFAULTS, RSS_DEFAULTS } from './defaults.js';

const FORMAT_DEFAULTS: Record<AnyFeed['format'], DefaultMap> = {
  rss: RSS_DEFAULTS,
  atom: ATOM_DEFAULTS,
  rdf: RDF_DEFAULTS,
  json: JSON_FEED_DEFAULTS,
};

/** Maps parsed objects to raw items. Invalid user JSONPath expressions surface as parse errors. */
export function mapObjects(raw: unknown[], defaults: DefaultMap, fields: FieldMap): Result<ParseOutput> {
  const records = raw.filter(isRecord);
  try {
    const items = records.slice(0, MAX_ITEMS_PER_FETCH).map((item) => mapObject(item, defaults, fields));
    const first = records[0];
    return ok({
      items,
      total: records.length,
      sample: first ? truncateSample(JSON.stringify(first, null, 2)) : null,
    });
  } catch (error) {
    return pipelineErr('parse', `Field mapping failed: ${errorMessage(error)}`, error);
  }
}

export function mapFeed(parsed: AnyFeed, fields: FieldMap): Result<ParseOutput> {
  const raw: unknown[] = (parsed.format === 'atom' ? parsed.feed.entries : parsed.feed.items) ?? [];
  return mapObjects(raw as JsonRecord[], FORMAT_DEFAULTS[parsed.format], fields);
}

export function parseXml(body: string, parser: XmlParserConfig): Result<ParseOutput> {
  let parsed: AnyFeed;
  try {
    parsed = parseFeed(body);
  } catch (error) {
    return pipelineErr('parse', `Not a valid RSS, Atom or RDF feed: ${errorMessage(error)}`, error);
  }
  return mapFeed(parsed, parser.fields);
}
