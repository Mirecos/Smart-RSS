import { createHash } from 'node:crypto';

export function sha1(...parts: Array<string | null | undefined>): string {
  const hash = createHash('sha1');
  for (const part of parts) hash.update(`${part ?? ''}\u0000`);
  return hash.digest('hex');
}
