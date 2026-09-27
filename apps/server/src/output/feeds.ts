import type { ItemDto } from '@smart-rss/shared';
import { generateAtomFeed, generateJsonFeed, generateRssFeed } from 'feedsmith';

export const OUTPUT_FORMATS = ['rss', 'atom', 'json'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface OutputFeed {
  title: string;
  siteUrl: string;
  selfUrl: string;
  items: ItemDto[];
}

const CONTENT_TYPES: Record<OutputFormat, string> = {
  rss: 'application/rss+xml; charset=utf-8',
  atom: 'application/atom+xml; charset=utf-8',
  json: 'application/feed+json; charset=utf-8',
};

const itemId = (item: ItemDto) => `${item.sourceId}:${item.guid}`;
const itemDate = (item: ItemDto) => new Date(item.publishedAt ?? item.fetchedAt);
const withoutUndefined = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null)) as T;

function rss(feed: OutputFeed): string {
  return generateRssFeed({
    title: feed.title,
    link: feed.siteUrl,
    description: feed.title,
    items: feed.items.map((item) =>
      withoutUndefined({
        title: item.title,
        link: item.link ?? undefined,
        guid: { value: itemId(item), isPermaLink: false },
        pubDate: itemDate(item),
        description: item.summary ?? item.contentHtml ?? undefined,
        content: item.contentHtml ? { encoded: item.contentHtml } : undefined,
        authors: item.author ? [{ name: item.author }] : undefined,
        categories: item.categories.length > 0 ? item.categories.map((name) => ({ name })) : undefined,
      }),
    ),
  });
}

function atom(feed: OutputFeed): string {
  const updated = feed.items[0] ? itemDate(feed.items[0]) : new Date(0);
  return generateAtomFeed({
    id: feed.selfUrl,
    title: { value: feed.title },
    updated,
    links: [{ href: feed.siteUrl }, { href: feed.selfUrl, rel: 'self' }],
    entries: feed.items.map((item) =>
      withoutUndefined({
        id: itemId(item),
        title: { value: item.title },
        updated: itemDate(item),
        links: item.link ? [{ href: item.link, rel: 'alternate' }] : undefined,
        summary: item.summary ? { value: item.summary, type: 'html' } : undefined,
        content: item.contentHtml ? { value: item.contentHtml, type: 'html' } : undefined,
        authors: item.author ? [{ name: item.author }] : undefined,
        categories: item.categories.length > 0 ? item.categories.map((term) => ({ term })) : undefined,
      }),
    ),
  });
}

function json(feed: OutputFeed): string {
  const document = generateJsonFeed({
    title: feed.title,
    home_page_url: feed.siteUrl,
    feed_url: feed.selfUrl,
    items: feed.items.map((item) =>
      withoutUndefined({
        id: itemId(item),
        url: item.link ?? undefined,
        title: item.title,
        content_html: item.contentHtml ?? item.summary ?? '',
        summary: item.summary ?? undefined,
        image: item.imageUrl ?? undefined,
        date_published: itemDate(item),
        authors: item.author ? [{ name: item.author }] : undefined,
        tags: item.categories.length > 0 ? item.categories : undefined,
      }),
    ),
  });
  // The JSON Feed spec requires "items", even when empty (the generator omits empty arrays).
  const generated = document as Record<string, unknown>;
  return JSON.stringify({ ...generated, items: generated.items ?? [] });
}

export function renderFeed(format: OutputFormat, feed: OutputFeed): { body: string; contentType: string } {
  const body = format === 'rss' ? rss(feed) : format === 'atom' ? atom(feed) : json(feed);
  return { body, contentType: CONTENT_TYPES[format] };
}
