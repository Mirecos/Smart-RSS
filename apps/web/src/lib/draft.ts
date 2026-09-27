import {
  httpUrlSchema,
  sourceConfigSchema,
  sourceCreateSchema,
  type FieldRule,
  type ItemField,
  type SourceConfigInput,
  type SourceCreate,
  type SourceDto,
  type SourceType,
} from '@smart-rss/shared';
import { DEFAULT_PRESET } from './presets';

/** Editable state of the source editor (mirrors the create payload). */
export interface SourceDraft {
  name: string;
  url: string;
  categoryId: number | null;
  refreshIntervalMinutes: number;
  enabled: boolean;
  config: SourceConfigInput;
}

export type Issues = Record<string, string>;

type Path = ReadonlyArray<string | number>;

/** Immutable deep update: returns a copy of `target` with `value` at `path` (undefined removes the key). */
export function setIn<T>(target: T, path: Path, value: unknown): T {
  const [head, ...rest] = path;
  if (head === undefined) return value as T;
  const source = (target ?? (typeof head === 'number' ? [] : {})) as Record<string | number, unknown>;
  const nextValue = setIn(source[head], rest, value);
  if (Array.isArray(source)) {
    return source.map((entry, index) => (index === head ? nextValue : entry)) as T;
  }
  const copy = { ...source, [head]: nextValue };
  if (nextValue === undefined) delete copy[head];
  return copy as T;
}

export function emptyDraft(defaultRefreshMinutes: number): SourceDraft {
  return {
    name: '',
    url: '',
    categoryId: null,
    refreshIntervalMinutes: defaultRefreshMinutes,
    enabled: true,
    config: structuredClone(DEFAULT_PRESET.config),
  };
}

export function draftFromSource(source: SourceDto): SourceDraft {
  return {
    name: source.name,
    url: source.url,
    categoryId: source.categoryId,
    refreshIntervalMinutes: source.refreshIntervalMinutes,
    enabled: source.enabled,
    config: structuredClone(source.config),
  };
}

function issuesFrom(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): Issues {
  const issues: Issues = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.');
    issues[key] ??= issue.message;
  }
  return issues;
}

/** An empty name falls back to the URL's host name. */
export function withDefaultName(draft: SourceDraft): SourceDraft {
  if (draft.name.trim() || !draft.url.trim()) return draft;
  try {
    return { ...draft, name: new URL(draft.url.trim()).hostname.replace(/^www\./, '') };
  } catch {
    return draft;
  }
}

export function validateDraft(draft: SourceDraft): { ok: true; value: SourceCreate } | { ok: false; issues: Issues } {
  const result = sourceCreateSchema.safeParse(withDefaultName(draft));
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: issuesFrom(result.error) };
}

/** Only the url and config matter for previews; returns null when they are not valid yet. */
export function previewable(draft: SourceDraft): { url: string; config: SourceConfigInput } | null {
  const url = httpUrlSchema.safeParse(draft.url);
  const config = sourceConfigSchema.safeParse(draft.config);
  return url.success && config.success ? { url: url.data, config: draft.config } : null;
}

/** Switches the parser type; JSONPath field rules survive a switch between xml and json. */
export function changeParserType(config: SourceConfigInput, type: SourceType): SourceConfigInput {
  const current = config.parser;
  if (current.type === type) return config;
  const keepFields = current.type !== 'html' && type !== 'html';
  const fields = keepFields ? (current.fields ?? {}) : {};
  const parser: SourceConfigInput['parser'] =
    type === 'html'
      ? { type, selectorType: 'css', itemSelector: 'article', fields }
      : type === 'json'
        ? { type, itemsPath: '', fields }
        : { type, fields };
  return { ...config, parser };
}

export function setFieldRule(config: SourceConfigInput, field: ItemField, rule: Partial<FieldRule> | undefined): SourceConfigInput {
  const cleaned = rule?.path?.trim()
    ? Object.fromEntries(Object.entries(rule).filter(([, v]) => v !== undefined && v !== ''))
    : undefined;
  return setIn(config, ['parser', 'fields', field], cleaned);
}

export function issuesUnder(issues: Issues, prefix: string): string[] {
  return Object.entries(issues)
    .filter(([key]) => key === prefix || key.startsWith(`${prefix}.`))
    .map(([key, message]) => `${key.slice(prefix.length + 1) || prefix}: ${message}`);
}
