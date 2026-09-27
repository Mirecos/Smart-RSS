import { z } from 'zod';

/** An item produced by the pipeline, before it is stored. */
export interface ParsedItem {
  guid: string;
  title: string;
  link: string | null;
  content: string | null;
  summary: string | null;
  author: string | null;
  image: string | null;
  categories: string[];
  /** ISO 8601 */
  publishedAt: string | null;
}

/** A stored item as returned by the API. */
export interface ItemDto {
  id: number;
  sourceId: number;
  sourceName: string;
  guid: string;
  title: string;
  link: string | null;
  contentHtml: string | null;
  summary: string | null;
  author: string | null;
  imageUrl: string | null;
  categories: string[];
  publishedAt: string | null;
  fetchedAt: string;
  isRead: boolean;
  isStarred: boolean;
}

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const MAX_PAGE_SIZE = 100;

export const itemQuerySchema = z.object({
  sourceId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  unread: booleanString,
  starred: booleanString,
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});
export type ItemQuery = z.infer<typeof itemQuerySchema>;

export const itemUpdateSchema = z
  .object({
    isRead: z.boolean().optional(),
    isStarred: z.boolean().optional(),
  })
  .refine((value) => value.isRead !== undefined || value.isStarred !== undefined, {
    message: 'Nothing to update',
  });
export type ItemUpdate = z.infer<typeof itemUpdateSchema>;

export const markReadSchema = z.object({
  sourceId: z.number().int().positive().optional(),
  categoryId: z.number().int().positive().optional(),
});
export type MarkReadRequest = z.infer<typeof markReadSchema>;
