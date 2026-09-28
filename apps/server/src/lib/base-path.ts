/**
 * Helpers for serving the app under a path prefix (BASE_PATH, e.g. "/smart-rss").
 * The base path is validated by config.ts: "" or "/segment[/segment…]" without a trailing slash.
 */

/** Returns the URL relative to the base path, or null when the URL is outside of it. */
export function stripBasePath(url: string, basePath: string): string | null {
  if (!basePath) return url;
  if (url === basePath) return '/';
  const next = url.charAt(basePath.length);
  if (url.startsWith(basePath) && (next === '/' || next === '?')) {
    const rest = url.slice(basePath.length);
    return rest.startsWith('?') ? `/${rest}` : rest;
  }
  return null;
}

/** Cookie path for the session: scoped to the app so other apps on the same domain never receive it. */
export const cookiePath = (basePath: string): string => basePath || '/';

/**
 * Tells the built web app where it lives: the <base href> makes the relative asset URLs resolve,
 * and the meta tag gives the base path to the client router and API client.
 */
export function injectBasePath(indexHtml: string, basePath: string): string {
  return indexHtml
    .replace(/<base href="[^"]*"\s*\/?>/, `<base href="${basePath}/" />`)
    .replace(/<meta name="smart-rss-base" content="[^"]*"\s*\/?>/, `<meta name="smart-rss-base" content="${basePath}" />`);
}
