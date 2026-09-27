import type { JsonParserConfig } from '@smart-rss/shared';
import { detectJsonFeed, parseFeed } from 'feedsmith';
import { errorMessage, pipelineErr, type Result } from '../../lib/result.js';
import type { ParseOutput } from '../types.js';
import { queryPath } from '../values.js';
import { GENERIC_JSON_DEFAULTS } from './defaults.js';
import { mapFeed, mapObjects } from './xml.js';

function parseJsonFeed(data: unknown, parser: JsonParserConfig): Result<ParseOutput> {
  if (!detectJsonFeed(data)) {
    return pipelineErr(
      'parse',
      'No items path is configured and the document is not a JSON Feed. Set an items path such as $.data[*].',
    );
  }
  try {
    return mapFeed(parseFeed(data), parser.fields);
  } catch (error) {
    return pipelineErr('parse', `Invalid JSON Feed: ${errorMessage(error)}`, error);
  }
}

export function parseJson(body: string, parser: JsonParserConfig): Result<ParseOutput> {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch (error) {
    return pipelineErr('parse', `Invalid JSON: ${errorMessage(error)}`, error);
  }
  if (!parser.itemsPath) return parseJsonFeed(data, parser);

  let found: unknown[];
  try {
    found = queryPath(data, parser.itemsPath);
  } catch (error) {
    return pipelineErr('parse', `Invalid items path "${parser.itemsPath}": ${errorMessage(error)}`, error);
  }
  // Accept both "$.items" (the array itself) and "$.items[*]" (its elements).
  const list = found.length === 1 && Array.isArray(found[0]) ? found[0] : found;
  if (list.length === 0) return pipelineErr('parse', `Items path "${parser.itemsPath}" matched nothing`);
  return mapObjects(list, GENERIC_JSON_DEFAULTS, parser.fields);
}
