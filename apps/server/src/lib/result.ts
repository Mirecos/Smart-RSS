import type { PipelineStage } from '@smart-rss/shared';

export type Result<T, E = PipelineError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export class PipelineError extends Error {
  constructor(
    readonly stage: PipelineStage,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PipelineError';
  }
}

export const pipelineErr = (stage: PipelineStage, message: string, cause?: unknown) =>
  err(new PipelineError(stage, message, { cause }));

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}
