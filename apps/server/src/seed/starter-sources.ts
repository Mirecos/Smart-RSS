import { sourceConfigSchema, type ImportResult, type SourceConfigInput } from '@smart-rss/shared';
import type { Repositories } from '../repositories/index.js';
import { importSources, type ImportEntry } from '../routes/backup.js';

const SEEDED_FLAG = 'starterSourcesSeeded';

interface StarterSource {
  name: string;
  url: string;
  category: 'News' | 'Tech' | 'Dev';
  refreshIntervalMinutes: number;
  config: SourceConfigInput;
}

const XML: SourceConfigInput = { parser: { type: 'xml' } };

/** A small, varied default set: one example of each source type (XML, JSON Feed, JSON API, HTML). */
export const STARTER_SOURCES: readonly StarterSource[] = [
  { name: 'BBC News – World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'News', refreshIntervalMinutes: 30, config: XML },
  { name: 'Le Monde – À la une', url: 'https://www.lemonde.fr/rss/une.xml', category: 'News', refreshIntervalMinutes: 30, config: XML },
  { name: 'Hacker News', url: 'https://hnrss.org/frontpage', category: 'Tech', refreshIntervalMinutes: 30, config: XML },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'Tech', refreshIntervalMinutes: 60, config: XML },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'Tech', refreshIntervalMinutes: 60, config: XML },
  {
    name: 'Daring Fireball (JSON Feed)',
    url: 'https://daringfireball.net/feeds/json',
    category: 'Tech',
    refreshIntervalMinutes: 60,
    config: { parser: { type: 'json' } },
  },
  {
    name: 'Node.js releases (GitHub API)',
    url: 'https://api.github.com/repos/nodejs/node/releases?per_page=20',
    category: 'Dev',
    // Unauthenticated GitHub API calls are rate limited: keep this one infrequent.
    refreshIntervalMinutes: 360,
    config: { parser: { type: 'json', itemsPath: '$[*]', fields: { title: { path: 'name' } } } },
  },
  {
    name: 'GitHub Trending (scraped)',
    url: 'https://github.com/trending',
    category: 'Dev',
    refreshIntervalMinutes: 720,
    config: {
      parser: {
        type: 'html',
        selectorType: 'css',
        itemSelector: 'article.Box-row',
        fields: {
          title: { path: 'h2 a', attr: 'text' },
          link: { path: 'h2 a', attr: 'href' },
          summary: { path: 'p', attr: 'text' },
        },
      },
      dedupeBy: 'link',
    },
  },
];

function toImportEntries(): ImportEntry[] {
  return STARTER_SOURCES.map((source) => ({
    name: source.name,
    url: source.url,
    category: source.category,
    refreshIntervalMinutes: source.refreshIntervalMinutes,
    config: sourceConfigSchema.parse(source.config),
  }));
}

/** Adds the starter sources that are not present yet (matched by URL). */
export function addStarterSources(repos: Repositories): ImportResult {
  return importSources(repos, toImportEntries());
}

/**
 * On the very first start (empty database) the starter sources are added once.
 * Existing installations with sources, or users who deleted them, are never re-seeded.
 */
export function seedOnFirstRun(repos: Repositories): ImportResult | null {
  if (repos.settings.getFlag(SEEDED_FLAG)) return null;
  const result = repos.sources.list().length === 0 ? addStarterSources(repos) : null;
  repos.settings.setFlag(SEEDED_FLAG, true);
  return result;
}
