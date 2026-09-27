import type { FieldRule } from '@smart-rss/shared';
import { isRecord, type DefaultMap, type JsonRecord } from '../values.js';
import type { MappedItem } from '../types.js';

const asRecords = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const isImageType = (type: unknown) => typeof type === 'string' && type.startsWith('image/');

const imageEnclosure = (item: JsonRecord) => asRecords(item.enclosures).find((e) => isImageType(e.type))?.url;

const mediaImage = (item: JsonRecord) => {
  const media = isRecord(item.media) ? item.media : {};
  return asRecords(media.contents).find((c) => c.medium === 'image' || isImageType(c.type))?.url;
};

const alternateLink = (item: JsonRecord) => {
  const links = asRecords(item.links);
  return (links.find((l) => !l.rel || l.rel === 'alternate') ?? links[0])?.href;
};

export const RSS_DEFAULTS: DefaultMap = {
  id: ['guid'],
  title: ['title'],
  link: ['link'],
  content: ['content.encoded', 'description'],
  summary: ['description'],
  author: ['dc.creators[0]', 'authors[0].name', 'authors[0].email', 'itunes.author'],
  publishedAt: ['pubDate', 'dc.dates[0]'],
  image: ['media.thumbnails[0].url', mediaImage, imageEnclosure, 'itunes.image'],
  categories: ['categories[*].name', 'dc.subjects[*]'],
};

export const ATOM_DEFAULTS: DefaultMap = {
  id: ['id'],
  title: ['title'],
  link: [alternateLink],
  content: ['content'],
  summary: ['summary'],
  author: ['authors[0].name'],
  publishedAt: ['published', 'updated'],
  image: ['media.thumbnails[0].url', mediaImage],
  categories: ['categories[*].label', 'categories[*].term'],
};

export const RDF_DEFAULTS: DefaultMap = {
  id: ['rdf.about', 'link'],
  title: ['title'],
  link: ['link'],
  content: ['content.encoded', 'description'],
  summary: ['description'],
  author: ['dc.creators[0]'],
  publishedAt: ['dc.dates[0]'],
  categories: ['dc.subjects[*]'],
};

export const JSON_FEED_DEFAULTS: DefaultMap = {
  id: ['id'],
  title: ['title'],
  link: ['url', 'external_url'],
  content: ['content_html', 'content_text'],
  summary: ['summary'],
  author: ['authors[0].name', 'author.name'],
  publishedAt: ['date_published', 'date_modified'],
  image: ['image', 'banner_image'],
  categories: ['tags[*]'],
};

/** Heuristics for arbitrary JSON APIs; explicit field rules always win. */
export const GENERIC_JSON_DEFAULTS: DefaultMap = {
  id: ['id', 'guid', 'uuid', 'slug'],
  title: ['title', 'name', 'headline'],
  // Human-facing links first: many APIs (e.g. GitHub) use "url" for the API resource itself.
  link: ['permalink', 'html_url', 'web_url', 'link', 'url', 'href'],
  content: ['content_html', 'content', 'body_html', 'body', 'html', 'text'],
  summary: ['summary', 'excerpt', 'description', 'abstract'],
  author: [
    'author.name', 'author.login', 'author.username', 'authors[0].name',
    'user.name', 'user.login', 'user.username', 'by', 'creator', 'author',
  ],
  publishedAt: [
    'published_at', 'publishedAt', 'date_published', 'pubDate', 'published', 'date',
    'created_at', 'createdAt', 'updated_at', 'timestamp', 'time',
  ],
  image: ['image.url', 'image', 'thumbnail.url', 'thumbnail', 'thumbnail_url', 'cover_image', 'cover'],
  categories: ['tags[*]', 'categories[*]'],
};

type HtmlDefaults = Partial<Record<keyof MappedItem, FieldRule>>;

export const CSS_DEFAULTS: HtmlDefaults = {
  title: { path: 'h1, h2, h3, h4, a', attr: 'text' },
  link: { path: 'a[href]', attr: 'href' },
  summary: { path: 'p', attr: 'text' },
  image: { path: 'img[src]', attr: 'src' },
  publishedAt: { path: 'time[datetime]', attr: 'datetime' },
};

export const XPATH_DEFAULTS: HtmlDefaults = {
  title: { path: '(.//h1|.//h2|.//h3|.//h4|.//a)[1]', attr: 'text' },
  link: { path: '(self::a/@href|.//a/@href)[1]' },
  summary: { path: '(.//p)[1]', attr: 'text' },
  image: { path: '(.//img/@src)[1]' },
  publishedAt: { path: '(.//time/@datetime)[1]' },
};
