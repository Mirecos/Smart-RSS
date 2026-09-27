import type { SourceConfigInput } from '@smart-rss/shared';

export interface Preset {
  id: string;
  label: string;
  description: string;
  config: SourceConfigInput;
}

export const PRESETS: Preset[] = [
  {
    id: 'rss',
    label: 'RSS / Atom feed',
    description: 'Standard XML feed (RSS 2.0, Atom, RDF). Fields are detected automatically.',
    config: { parser: { type: 'xml', fields: {} } },
  },
  {
    id: 'json-feed',
    label: 'JSON Feed',
    description: 'A jsonfeed.org document. Fields are detected automatically.',
    config: { parser: { type: 'json', fields: {} } },
  },
  {
    id: 'json-api',
    label: 'JSON API',
    description: 'Any JSON endpoint: point "Items path" to the list and map the fields with JSONPath.',
    config: {
      parser: {
        type: 'json',
        itemsPath: '$.items[*]',
        fields: { title: { path: 'title' }, link: { path: 'url' } },
      },
    },
  },
  {
    id: 'html-blog',
    label: 'Web page (CSS selectors)',
    description: 'Scrape a page without a feed: one CSS selector per item, then one per field.',
    config: {
      parser: {
        type: 'html',
        selectorType: 'css',
        itemSelector: 'article',
        fields: {
          title: { path: 'h2, h3', attr: 'text' },
          link: { path: 'a[href]', attr: 'href' },
          summary: { path: 'p', attr: 'text' },
          publishedAt: { path: 'time', attr: 'datetime' },
          image: { path: 'img', attr: 'src' },
        },
      },
    },
  },
  {
    id: 'html-xpath',
    label: 'Web page (XPath)',
    description: 'Same as above with XPath expressions, e.g. string(.//h2) or .//a/@href.',
    config: {
      parser: {
        type: 'html',
        selectorType: 'xpath',
        itemSelector: '//article',
        fields: {
          title: { path: 'string(.//h2)' },
          link: { path: '(.//a/@href)[1]' },
          summary: { path: 'string(.//p)' },
        },
      },
    },
  },
];

export const DEFAULT_PRESET = PRESETS[0] as Preset;
