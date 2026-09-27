import type { Filter, FilterableField, ParsedItem } from '@smart-rss/shared';
import { htmlToText } from '../lib/html.js';
import { errorMessage, ok, pipelineErr, type Result } from '../lib/result.js';

const MAX_FILTER_INPUT = 20_000;

export interface CompiledFilter {
  mode: Filter['mode'];
  field: FilterableField;
  regex: RegExp;
}

function fieldText(item: ParsedItem, field: FilterableField): string {
  const byField: Record<Exclude<FilterableField, 'any'>, () => string> = {
    title: () => item.title,
    link: () => item.link ?? '',
    author: () => item.author ?? '',
    summary: () => htmlToText(item.summary ?? ''),
    content: () => htmlToText(item.content ?? ''),
  };
  const text =
    field === 'any'
      ? Object.values(byField)
          .map((read) => read())
          .join('\n')
      : byField[field]();
  return text.slice(0, MAX_FILTER_INPUT);
}

export function compileFilters(filters: Filter[]): Result<CompiledFilter[]> {
  try {
    return ok(
      filters.map((filter) => ({
        mode: filter.mode,
        field: filter.field,
        // "g"/"y" make RegExp.test stateful, which is never wanted for filtering.
        regex: new RegExp(filter.pattern, filter.flags.replace(/[gy]/g, '')),
      })),
    );
  } catch (error) {
    return pipelineErr('filter', `Invalid filter: ${errorMessage(error)}`, error);
  }
}

/** Keeps items matching at least one include filter (if any) and no exclude filter. */
export function applyFilters(items: ParsedItem[], filters: CompiledFilter[]): ParsedItem[] {
  if (filters.length === 0) return items;
  const includes = filters.filter((f) => f.mode === 'include');
  const excludes = filters.filter((f) => f.mode === 'exclude');
  const matches = (item: ParsedItem, filter: CompiledFilter) => filter.regex.test(fieldText(item, filter.field));
  return items.filter(
    (item) =>
      (includes.length === 0 || includes.some((f) => matches(item, f))) &&
      !excludes.some((f) => matches(item, f)),
  );
}
