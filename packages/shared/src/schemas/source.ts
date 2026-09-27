import { z } from 'zod';
import { regexFlagsSchema, regexPatternSchema } from './regex.js';

export const SOURCE_TYPES = ['xml', 'json', 'html'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const ITEM_FIELDS = [
  'id',
  'title',
  'link',
  'content',
  'summary',
  'author',
  'publishedAt',
  'image',
  'categories',
] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];

/** Fields whose raw string value can be rewritten by transforms (before normalization). */
export const TRANSFORMABLE_FIELDS = [
  'title',
  'link',
  'content',
  'summary',
  'author',
  'publishedAt',
  'image',
] as const;
export type TransformableField = (typeof TRANSFORMABLE_FIELDS)[number];

export const FILTERABLE_FIELDS = ['any', 'title', 'content', 'summary', 'author', 'link'] as const;
export type FilterableField = (typeof FILTERABLE_FIELDS)[number];

export const MIN_REFRESH_MINUTES = 5;
export const MAX_REFRESH_MINUTES = 7 * 24 * 60;

export const httpUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .pipe(z.url({ protocol: /^https?$/, message: 'Must be an http(s) URL' }));

/**
 * How to extract one item field.
 * - xml/json sources: `path` is a JSONPath evaluated against the item object (e.g. `media.thumbnails[0].url`).
 * - html sources: `path` is a CSS selector or XPath relative to the item element ("." = the item itself).
 */
export const fieldRuleSchema = z.object({
  path: z.string().trim().min(1, 'Path is required').max(500),
  /** html only: "text" (default), "html", or an attribute name such as "href". */
  attr: z
    .string()
    .trim()
    .max(100)
    .regex(/^[A-Za-z_:][-A-Za-z0-9_:.]*$/, 'Invalid attribute name')
    .optional(),
  /** publishedAt only: date-fns format string, e.g. "dd/MM/yyyy HH:mm". */
  dateFormat: z.string().trim().max(100).optional(),
});
export type FieldRule = z.infer<typeof fieldRuleSchema>;

export const fieldMapSchema = z.object(
  Object.fromEntries(ITEM_FIELDS.map((field) => [field, fieldRuleSchema.optional()])) as Record<
    ItemField,
    z.ZodOptional<typeof fieldRuleSchema>
  >,
);
export type FieldMap = z.infer<typeof fieldMapSchema>;

const xmlParserSchema = z.object({
  type: z.literal('xml'),
  fields: fieldMapSchema.prefault({}),
});

const jsonParserSchema = z.object({
  type: z.literal('json'),
  /** JSONPath to the list of items. Leave empty for JSON Feed documents. */
  itemsPath: z.string().trim().max(500).optional(),
  fields: fieldMapSchema.prefault({}),
});

const htmlParserSchema = z.object({
  type: z.literal('html'),
  selectorType: z.enum(['css', 'xpath']).default('css'),
  itemSelector: z.string().trim().min(1, 'Item selector is required').max(500),
  fields: fieldMapSchema.prefault({}),
});

export const parserSchema = z.discriminatedUnion('type', [
  xmlParserSchema,
  jsonParserSchema,
  htmlParserSchema,
]);
export type ParserConfig = z.infer<typeof parserSchema>;
export type HtmlParserConfig = z.infer<typeof htmlParserSchema>;
export type JsonParserConfig = z.infer<typeof jsonParserSchema>;
export type XmlParserConfig = z.infer<typeof xmlParserSchema>;

export const fetchOptionsSchema = z.object({
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z
    .record(
      z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, 'Invalid header name'),
      z.string().max(2000),
    )
    .default({}),
  body: z.string().max(10_000).optional(),
  userAgent: z.string().trim().max(300).optional(),
  timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
  /** Render the page in headless Chromium (requires the optional renderer service). */
  render: z.boolean().default(false),
});
export type FetchOptions = z.infer<typeof fetchOptionsSchema>;

const transformField = z.enum(TRANSFORMABLE_FIELDS);

export const transformSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('regexReplace'),
    field: transformField,
    pattern: regexPatternSchema,
    flags: regexFlagsSchema.default('g'),
    replacement: z.string().max(1000).default(''),
  }),
  z.object({ op: z.literal('stripHtml'), field: transformField }),
  z.object({ op: z.literal('trim'), field: transformField }),
  z.object({ op: z.literal('truncate'), field: transformField, length: z.number().int().min(1).max(100_000) }),
  z.object({ op: z.literal('defaultValue'), field: transformField, value: z.string().max(1000) }),
]);
export type Transform = z.infer<typeof transformSchema>;
export type TransformOp = Transform['op'];

export const filterSchema = z.object({
  field: z.enum(FILTERABLE_FIELDS).default('any'),
  mode: z.enum(['include', 'exclude']),
  pattern: regexPatternSchema,
  flags: regexFlagsSchema.default('i'),
});
export type Filter = z.infer<typeof filterSchema>;

export const fullTextSchema = z
  .object({
    mode: z.enum(['off', 'readability', 'selector']).default('off'),
    selector: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.mode !== 'selector' || Boolean(value.selector), {
    message: 'A CSS selector is required when full-text mode is "selector"',
    path: ['selector'],
  });
export type FullTextConfig = z.infer<typeof fullTextSchema>;

export const DEDUPE_STRATEGIES = ['guid', 'link', 'titleHash'] as const;

export const sourceConfigSchema = z.object({
  fetch: fetchOptionsSchema.prefault({}),
  parser: parserSchema,
  fullText: fullTextSchema.prefault({}),
  transforms: z.array(transformSchema).max(50).default([]),
  filters: z.array(filterSchema).max(50).default([]),
  dedupeBy: z.enum(DEDUPE_STRATEGIES).default('guid'),
});
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type SourceConfigInput = z.input<typeof sourceConfigSchema>;

const sourceFields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  url: httpUrlSchema,
  categoryId: z.number().int().positive().nullable(),
  refreshIntervalMinutes: z.number().int().min(MIN_REFRESH_MINUTES).max(MAX_REFRESH_MINUTES),
  enabled: z.boolean(),
  config: sourceConfigSchema,
};

export const sourceCreateSchema = z.object({
  ...sourceFields,
  categoryId: sourceFields.categoryId.default(null),
  refreshIntervalMinutes: sourceFields.refreshIntervalMinutes.default(60),
  enabled: sourceFields.enabled.default(true),
});
export type SourceCreate = z.infer<typeof sourceCreateSchema>;
export type SourceCreateInput = z.input<typeof sourceCreateSchema>;

export const sourceUpdateSchema = z.object(sourceFields).partial();
export type SourceUpdate = z.infer<typeof sourceUpdateSchema>;

export const previewRequestSchema = z.object({
  url: httpUrlSchema,
  config: sourceConfigSchema,
});
export type PreviewRequest = z.infer<typeof previewRequestSchema>;

export const rawRequestSchema = z.object({
  url: httpUrlSchema,
  fetch: fetchOptionsSchema.prefault({}),
});
export type RawRequest = z.infer<typeof rawRequestSchema>;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;
