import { userCreateSchema, userUpdateSchema } from '@smart-rss/shared';
import type { FastifyInstance } from 'fastify';
import { currentUser, SESSION_COOKIE } from '../auth/plugin.js';
import { HttpError, notFound, parseOrThrow, success } from '../lib/http.js';
import { hashPassword } from '../lib/password.js';
import type { RouteContext } from './context.js';
import { idParamsSchema } from './sources.js';

/** User management. Admin-only (enforced centrally by auth/access.ts). */
export function registerUserRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { users, sessions } = ctx.repos;

  const requireUser = (id: number) => {
    const user = users.getById(id);
    if (!user) throw notFound('User');
    return user;
  };

  const assertNotLastAdmin = (role: string) => {
    if (role === 'admin' && users.countAdmins() <= 1) {
      throw new HttpError(400, 'There must always be at least one administrator');
    }
  };

  app.get('/users', async () => success(users.list()));

  app.post('/users', async (request, reply) => {
    const input = parseOrThrow(userCreateSchema, request.body);
    if (users.findCredentials(input.username)) throw new HttpError(409, `User "${input.username}" already exists`);
    const created = users.create({ username: input.username, role: input.role, passwordHash: await hashPassword(input.password) });
    return reply.status(201).send(success(created));
  });

  app.patch('/users/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    const patch = parseOrThrow(userUpdateSchema, request.body);
    const target = requireUser(id);
    if (patch.role === 'user') assertNotLastAdmin(target.role);
    const passwordHash = patch.password ? await hashPassword(patch.password) : undefined;
    const updated = users.update(id, { role: patch.role, passwordHash }, ctx.now().toISOString());
    if (passwordHash) {
      // A reset signs the user out everywhere (the admin keeps this session when resetting themselves).
      const keep = id === currentUser(request).id ? request.cookies[SESSION_COOKIE] : undefined;
      sessions.removeForUser(id, keep);
    }
    return success(updated);
  });

  app.delete('/users/:id', async (request) => {
    const { id } = parseOrThrow(idParamsSchema, request.params);
    if (id === currentUser(request).id) throw new HttpError(400, 'You cannot delete your own account');
    assertNotLastAdmin(requireUser(id).role);
    users.remove(id);
    return success(null);
  });
}
