/**
 * Path prefix the app is served under (e.g. "/smart-rss"), injected into index.html by the server.
 * "" when the app is served at the domain root (and during `vite dev`).
 */
export function readBasePath(doc: Document = document): string {
  const value = doc.querySelector('meta[name="smart-rss-base"]')?.getAttribute('content') ?? '';
  return value.replace(/\/+$/, '');
}

export const BASE_PATH = readBasePath();

/** Prefixes an absolute app path ("/api/…", "/feeds/…") with the base path. */
export const withBase = (path: string): string => `${BASE_PATH}${path}`;
