import safeRegex from 'safe-regex2';
import { z } from 'zod';

export const MAX_REGEX_LENGTH = 500;

/** Returns an error message when the pattern is invalid or prone to catastrophic backtracking. */
export function checkRegex(pattern: string, flags = ''): string | null {
  try {
    new RegExp(pattern, flags);
  } catch (error) {
    return `Invalid regular expression: ${(error as Error).message}`;
  }
  if (!safeRegex(pattern)) {
    return 'Regular expression is too complex (possible catastrophic backtracking)';
  }
  return null;
}

export const regexPatternSchema = z
  .string()
  .min(1, 'Pattern is required')
  .max(MAX_REGEX_LENGTH)
  .superRefine((pattern, ctx) => {
    const problem = checkRegex(pattern);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const regexFlagsSchema = z
  .string()
  .regex(/^(?!.*(.).*\1)[gimsu]*$/, 'Flags may only contain g, i, m, s, u (each once)');
