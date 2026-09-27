import type { UserDto, UserRole } from '@smart-rss/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/client.js';

const TOKEN_BYTES = 32;

/** Only a hash of the token is stored: a leaked database cannot be used to hijack sessions. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

interface SessionUserRow {
  id: number;
  username: string;
  role: UserRole;
  created_at: string;
  expires_at: string;
}

export interface ActiveSession {
  user: UserDto;
  expiresAt: string;
}

export function createSessionsRepository(db: Db) {
  const insertStmt = db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (@tokenHash, @userId, @createdAt, @expiresAt)',
  );
  const findStmt = db.prepare<[string, string], SessionUserRow>(
    `SELECT u.id, u.username, u.role, u.created_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  );
  const extendStmt = db.prepare<[string, string]>('UPDATE sessions SET expires_at = ? WHERE token_hash = ?');
  const deleteStmt = db.prepare<[string]>('DELETE FROM sessions WHERE token_hash = ?');
  const deleteForUserStmt = db.prepare<[number, string]>('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?');
  const purgeStmt = db.prepare<[string]>('DELETE FROM sessions WHERE expires_at <= ?');

  return {
    /** Creates a session and returns the raw token (to put in the cookie). */
    create(userId: number, now: Date, ttlMs: number): string {
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      insertStmt.run({
        tokenHash: hashToken(token),
        userId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      });
      return token;
    },
    find(token: string, now: Date): ActiveSession | null {
      const row = findStmt.get(hashToken(token), now.toISOString());
      if (!row) return null;
      return {
        user: { id: row.id, username: row.username, role: row.role, createdAt: row.created_at },
        expiresAt: row.expires_at,
      };
    },
    extend(token: string, expiresAt: Date): void {
      extendStmt.run(expiresAt.toISOString(), hashToken(token));
    },
    remove(token: string): void {
      deleteStmt.run(hashToken(token));
    },
    /** Signs a user out everywhere, optionally keeping the current session. */
    removeForUser(userId: number, exceptToken?: string): number {
      return deleteForUserStmt.run(userId, exceptToken ? hashToken(exceptToken) : '').changes;
    },
    purgeExpired: (now: Date): number => purgeStmt.run(now.toISOString()).changes,
  };
}

export type SessionsRepository = ReturnType<typeof createSessionsRepository>;
