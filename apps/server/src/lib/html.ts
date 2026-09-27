import * as cheerio from 'cheerio';

const WHITESPACE = /\s+/g;

export function collapseWhitespace(value: string): string {
  return value.replace(WHITESPACE, ' ').trim();
}

/** Converts an HTML fragment to plain text (entities decoded, whitespace collapsed). */
export function htmlToText(html: string): string {
  if (!/[<&]/.test(html)) return collapseWhitespace(html);
  return collapseWhitespace(cheerio.load(`<body>${html}</body>`)('body').text());
}

/** Resolves a possibly-relative URL; only http(s) results are accepted. */
export function resolveUrl(value: string | null | undefined, base: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = base ? new URL(trimmed, base) : new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
