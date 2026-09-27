import { hashPassword } from '../lib/password.js';
import type { Repositories } from '../repositories/index.js';

export type BootstrapResult = 'created' | 'exists' | 'not-configured';

export interface InitialAdmin {
  username: string | null;
  password: string | null;
}

/**
 * Creates the first administrator from ADMIN_USERNAME / ADMIN_PASSWORD when no user exists yet.
 * The pre-authentication read/star state is handed over to that admin. Values are validated by config.ts.
 */
export async function ensureInitialAdmin(repos: Repositories, admin: InitialAdmin): Promise<BootstrapResult> {
  if (repos.users.count() > 0) return 'exists';
  if (!admin.username || !admin.password) return 'not-configured';
  const user = repos.users.create({
    username: admin.username,
    passwordHash: await hashPassword(admin.password),
    role: 'admin',
  });
  repos.items.adoptLegacyState(user.id);
  return 'created';
}
