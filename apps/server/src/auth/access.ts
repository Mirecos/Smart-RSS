export type Access = 'public' | 'user' | 'admin';

type Rule = readonly [method: string, path: RegExp];

const PUBLIC_API: readonly Rule[] = [
  ['GET', /^\/api\/health$/],
  ['GET', /^\/api\/auth\/status$/],
  ['POST', /^\/api\/auth\/login$/],
];

/** The only writes a read-only user may perform: reading state and their own account. */
const USER_WRITES: readonly Rule[] = [
  ['POST', /^\/api\/auth\/(logout|password)$/],
  ['POST', /^\/api\/items\/mark-read$/],
  ['PATCH', /^\/api\/items\/\d+$/],
];

const ADMIN_READS: readonly RegExp[] = [/^\/api\/users(\/|$)/, /^\/api\/export$/, /^\/api\/opml$/];

const READ_METHODS = new Set(['GET', 'HEAD']);

const matches = (rules: readonly Rule[], method: string, path: string) =>
  rules.some(([ruleMethod, pattern]) => ruleMethod === method && pattern.test(path));

/**
 * Central, fail-closed authorization rule. Anything under /api/ requires a session; every write
 * requires the admin role unless it is explicitly listed above. Non-API paths (web app, /feeds) are public.
 */
export function requiredAccess(method: string, url: string): Access {
  const path = url.split('?')[0] ?? '';
  if (!path.startsWith('/api/')) return 'public';
  if (matches(PUBLIC_API, method, path)) return 'public';
  if (READ_METHODS.has(method)) return ADMIN_READS.some((pattern) => pattern.test(path)) ? 'admin' : 'user';
  return matches(USER_WRITES, method, path) ? 'user' : 'admin';
}
