import type { Db } from '../db/client.js';
import { createCategoriesRepository } from './categories.js';
import { createFetchLogRepository } from './fetch-log.js';
import { createItemsRepository } from './items.js';
import { createSessionsRepository } from './sessions.js';
import { createSettingsRepository } from './settings.js';
import { createSourcesRepository } from './sources.js';
import { createUsersRepository } from './users.js';

export function createRepositories(db: Db) {
  return {
    categories: createCategoriesRepository(db),
    sources: createSourcesRepository(db),
    items: createItemsRepository(db),
    settings: createSettingsRepository(db),
    fetchLog: createFetchLogRepository(db),
    users: createUsersRepository(db),
    sessions: createSessionsRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
