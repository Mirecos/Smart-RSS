import type { CategoryDto } from '@smart-rss/shared';
import type { Db } from '../db/client.js';

interface CategoryRow {
  id: number;
  name: string;
  unread_count: number;
}

const SELECT_WITH_COUNTS = `
  SELECT c.id, c.name,
    (SELECT COUNT(*) FROM items i JOIN sources s ON s.id = i.source_id
      WHERE s.category_id = c.id AND i.purged = 0 AND NOT EXISTS
        (SELECT 1 FROM item_states st WHERE st.item_id = i.id AND st.user_id = @userId AND st.is_read = 1)) AS unread_count
  FROM categories c`;

const toDto = (row: CategoryRow): CategoryDto => ({
  id: row.id,
  name: row.name,
  unreadCount: row.unread_count,
});

export function createCategoriesRepository(db: Db) {
  type UserParam = { userId: number | null };
  const listStmt = db.prepare<[UserParam], CategoryRow>(`${SELECT_WITH_COUNTS} ORDER BY c.name COLLATE NOCASE`);
  const byIdStmt = db.prepare<[UserParam & { id: number }], CategoryRow>(`${SELECT_WITH_COUNTS} WHERE c.id = @id`);
  const byNameStmt = db.prepare<[UserParam & { name: string }], CategoryRow>(`${SELECT_WITH_COUNTS} WHERE c.name = @name`);
  const insertStmt = db.prepare<[string]>('INSERT INTO categories (name) VALUES (?)');
  const renameStmt = db.prepare<[string, number]>('UPDATE categories SET name = ? WHERE id = ?');
  const deleteStmt = db.prepare<[number]>('DELETE FROM categories WHERE id = ?');

  /** userId selects whose unread count is returned (null = everything unread). */
  const getById = (id: number, userId: number | null = null): CategoryDto | null => {
    const row = byIdStmt.get({ id, userId });
    return row ? toDto(row) : null;
  };

  const findByName = (name: string): CategoryDto | null => {
    const row = byNameStmt.get({ name, userId: null });
    return row ? toDto(row) : null;
  };

  const create = (name: string): CategoryDto => {
    const { lastInsertRowid } = insertStmt.run(name);
    return getById(Number(lastInsertRowid)) as CategoryDto;
  };

  return {
    list: (userId: number | null = null): CategoryDto[] => listStmt.all({ userId }).map(toDto),
    getById,
    findByName,
    create,
    /** Returns the existing category with this name (case-insensitive) or creates it. */
    ensure: (name: string): CategoryDto => findByName(name) ?? create(name),
    rename(id: number, name: string): CategoryDto | null {
      renameStmt.run(name, id);
      return getById(id);
    },
    remove: (id: number): boolean => deleteStmt.run(id).changes > 0,
  };
}

export type CategoriesRepository = ReturnType<typeof createCategoriesRepository>;
