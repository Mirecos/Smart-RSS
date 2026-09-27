import type { ParsedItem } from '@smart-rss/shared';
import sanitizeHtml from 'sanitize-html';
import { resolveUrl } from '../lib/html.js';

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  'img', 'figure', 'figcaption', 'picture', 'h1', 'h2', 'del', 'ins', 'sup', 'sub',
];

const MAX_HTML_LENGTH = 500_000;

function resolveHref(href: string | undefined, baseUrl: string): string {
  if (href?.trim().toLowerCase().startsWith('mailto:')) return href.trim();
  return resolveUrl(href, baseUrl) ?? '';
}

/** Allow-list sanitizer for remote HTML; relative links and images are made absolute. */
export function sanitizeContent(html: string, baseUrl: string): string {
  return sanitizeHtml(html.slice(0, MAX_HTML_LENGTH), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          href: resolveHref(attribs.href, baseUrl),
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
        },
      }),
      img: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          src: resolveUrl(attribs.src || attribs['data-src'], baseUrl) ?? '',
          loading: 'lazy',
        },
      }),
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  }).trim();
}

export function sanitizeItem(item: ParsedItem, fallbackBaseUrl: string): ParsedItem {
  const baseUrl = item.link ?? fallbackBaseUrl;
  const content = item.content ? sanitizeContent(item.content, baseUrl) || null : null;
  const summary = item.summary ? sanitizeContent(item.summary, baseUrl) || null : null;
  return { ...item, content, summary };
}
