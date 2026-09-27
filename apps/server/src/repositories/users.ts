import type { UserDto, UserRole } from '@smart-rss/shared';
import type { Db } from '../db/client.js';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

export interface NewUser {
  username: string;
  passwordHash: string;
  role: UserRole;
}

const toDto = (row: UserRow): UserDto => ({
  id: row.id,
  username: row.username,
  role: row.role,
  createdAt: row.created_at,
});

export function createUsersRepository(db: Db) {
  const listStmt = db.prepare<[], UserRow>('SELECT * FROM users ORDER BY username COLLATE NOCASE');
  const byIdStmt = db.prepare<[number], UserRow>('SELECT * FROM users WHERE id = ?');
  const byNameStmt = db.prepare<[string], UserRow>('SELECT * FROM users WHERE username = ?');
  const countStmt = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM users');
  const adminCountStmt = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  const insertStmt = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (@username, @passwordHash, @role)');
  const deleteStmt = db.prepare<[number]>('DELETE FROM users WHERE id = ?');

  const getById = (id: number): UserDto | null => {
    const row = byIdStmt.get(id);
    return row ? toDto(row) : null;
  };

  return {
    list: (): UserDto[] => listStmt.all().map(toDto),
    getById,
    /** Case-insensitive lookup returning the password hash (for login only). */
    findCredentials(username: string): { user: UserDto; passwordHash: string } | null {
      const row = byNameStmt.get(username);
      return row ? { user: toDto(row), passwordHash: row.password_hash } : null;
    },
    getPasswordHash: (id: number): string | null => byIdStmt.get(id)?.password_hash ?? null,
    count: (): number => countStmt.get()?.n ?? 0,
    countAdmins: (): number => adminCountStmt.get()?.n ?? 0,
    create(user: NewUser): UserDto {
      const { lastInsertRowid } = insertStmt.run(user);
      return getById(Number(lastInsertRowid)) as UserDto;
    },
    update(id: number, patch: { role?: UserRole; passwordHash?: string }, now: string): UserDto | null {
      const sets = ['updated_at = @now'];
      if (patch.role !== undefined) sets.push('role = @role');
      if (patch.passwordHash !== undefined) sets.push('password_hash = @passwordHash');
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run({
        role: patch.role ?? null,
        passwordHash: patch.passwordHash ?? null,
        now,
        id,
      });
      return getById(id);
    },
    remove: (id: number): boolean => deleteStmt.run(id).changes > 0,
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
