import type { ApiSuccess, PageMeta } from '@smart-rss/shared';
import type { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new HttpError(400, 'Validation failed', details);
  }
  return result.data;
}

export function success<T>(data: T, meta?: PageMeta): ApiSuccess<T> {
  return meta ? { success: true, data, error: null, meta } : { success: true, data, error: null };
}
