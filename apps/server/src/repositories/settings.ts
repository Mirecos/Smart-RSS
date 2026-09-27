import { DEFAULT_SETTINGS, settingsSchema, type Settings } from '@smart-rss/shared';
import type { Db } from '../db/client.js';

export function createSettingsRepository(db: Db) {
  const allStmt = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings');
  const upsertStmt = db.prepare<[string, string]>(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  );
  const byKeyStmt = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?');

  const get = (): Settings => {
    const stored = Object.fromEntries(allStmt.all().map((row) => [row.key, JSON.parse(row.value)]));
    const merged = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...stored });
    return merged.success ? merged.data : DEFAULT_SETTINGS;
  };

  return {
    get,
    update(patch: Partial<Settings>): Settings {
      db.transaction(() => {
        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) upsertStmt.run(key, JSON.stringify(value));
        }
      })();
      return get();
    },
    /** Internal boolean markers (not user settings), e.g. one-time migrations. */
    getFlag: (key: string): boolean => byKeyStmt.get(key)?.value === 'true',
    setFlag(key: string, value: boolean): void {
      upsertStmt.run(key, JSON.stringify(value));
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
