import { sourceCreateSchema } from '@smart-rss/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client.js';
import { createRepositories, type Repositories } from '../repositories/index.js';
import { addStarterSources, seedOnFirstRun, STARTER_SOURCES } from './starter-sources.js';

describe('starter sources', () => {
  let repos: Repositories;

  beforeEach(() => {
    repos = createRepositories(openDatabase(':memory:'));
  });

  it('are valid and cover every source type', () => {
    for (const source of STARTER_SOURCES) {
      expect(sourceCreateSchema.safeParse({ ...source, categoryId: null }).success).toBe(true);
    }
    expect(new Set(STARTER_SOURCES.map((s) => s.config.parser.type))).toEqual(new Set(['xml', 'json', 'html']));
  });

  it('adds sources with their categories and skips existing urls', () => {
    const first = addStarterSources(repos);
    const second = addStarterSources(repos);

    expect(first).toEqual({ created: STARTER_SOURCES.length, skipped: 0, errors: [] });
    expect(second).toEqual({ created: 0, skipped: STARTER_SOURCES.length, errors: [] });
    expect(repos.categories.list().map((c) => c.name)).toEqual(['Dev', 'News', 'Tech']);
  });

  it('seeds only once, and only into an empty database', () => {
    expect(seedOnFirstRun(repos)?.created).toBe(STARTER_SOURCES.length);
    for (const source of repos.sources.list()) repos.sources.remove(source.id);

    expect(seedOnFirstRun(repos)).toBeNull();
    expect(repos.sources.list()).toHaveLength(0);
  });

  it('never seeds an existing installation that already has sources', () => {
    repos.sources.create(sourceCreateSchema.parse({ name: 'Mine', url: 'https://mine.example.com/rss', config: { parser: { type: 'xml' } } }));

    expect(seedOnFirstRun(repos)).toBeNull();
    expect(repos.sources.list().map((s) => s.name)).toEqual(['Mine']);
    expect(repos.settings.getFlag('starterSourcesSeeded')).toBe(true);
  });
});
