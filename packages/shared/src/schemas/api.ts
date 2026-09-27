import { z } from 'zod';
import type { ParsedItem } from './item.js';
import type { SourceConfig } from './source.js';
import { MAX_REFRESH_MINUTES, MIN_REFRESH_MINUTES, sourceConfigSchema } from './source.js';

export interface PageMeta {
  nextCursor: string | null;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  error: null;
  meta?: PageMeta;
}

export interface ApiErrorBody {
  message: string;
  details?: unknown;
}

export interface ApiFailure {
  success: false;
  data: null;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface SourceHealth {
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  pausedReason: string | null;
}

export interface SourceDto {
  id: number;
  name: string;
  url: string;
  categoryId: number | null;
  refreshIntervalMinutes: number;
  enabled: boolean;
  config: SourceConfig;
  health: SourceHealth;
  unreadCount: number;
  totalCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FetchLogEntry {
  id: number;
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'not_modified' | 'error';
  httpStatus: number | null;
  newItems: number;
  error: string | null;
}

export interface SourceDetailDto extends SourceDto {
  fetchLog: FetchLogEntry[];
}

export interface CategoryDto {
  id: number;
  name: string;
  unreadCount: number;
}

export const PIPELINE_STAGES = [
  'fetch',
  'parse',
  'transform',
  'normalize',
  'filter',
  'dedupe',
  'fulltext',
  'sanitize',
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface Diagnostic {
  stage: PipelineStage;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface HttpInfo {
  status: number | null;
  finalUrl: string | null;
  contentType: string | null;
  bytes: number;
}

export interface PreviewResult {
  ok: boolean;
  items: ParsedItem[];
  diagnostics: Diagnostic[];
  http: HttpInfo;
  /** Raw representation of the first parsed item (JSON for xml/json sources, HTML for html sources). */
  sample: string | null;
  durationMs: number;
}

export interface RawResult {
  http: HttpInfo;
  body: string;
  truncated: boolean;
}

export interface RefreshOutcome {
  status: 'ok' | 'not_modified' | 'error';
  newItems: number;
  error: string | null;
}

export interface HealthDto {
  status: 'ok';
  version: string;
  renderer: { configured: boolean; reachable: boolean };
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

export const settingsSchema = z.object({
  /** Items that are read, not starred and older than this are purged. 0 = keep forever. */
  retentionDays: z.number().int().min(0).max(3650),
  defaultRefreshMinutes: z.number().int().min(MIN_REFRESH_MINUTES).max(MAX_REFRESH_MINUTES),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsUpdateSchema = settingsSchema.partial();

export const DEFAULT_SETTINGS: Settings = { retentionDays: 30, defaultRefreshMinutes: 60 };

export const opmlImportSchema = z.object({
  content: z.string().min(1).max(5_000_000),
});

export const BACKUP_VERSION = 1;

export const backupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exportedAt: z.string().optional(),
  categories: z.array(z.string().trim().min(1).max(100)).max(1000),
  sources: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        url: z.string().trim().max(2000),
        category: z.string().trim().max(100).nullable(),
        refreshIntervalMinutes: z.number().int().min(MIN_REFRESH_MINUTES).max(MAX_REFRESH_MINUTES),
        enabled: z.boolean(),
        config: sourceConfigSchema,
      }),
    )
    .max(5000),
});
export type Backup = z.infer<typeof backupSchema>;
