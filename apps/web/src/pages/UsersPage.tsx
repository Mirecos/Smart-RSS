import { MIN_PASSWORD_LENGTH, type UserDto, type UserRole } from '@smart-rss/shared';
import { useState, type FormEvent } from 'react';
import { useCurrentUser } from '../auth/AuthContext';
import { Badge, Button, Card, ErrorBanner, Field, Input, SectionTitle, Select, Spinner } from '../components/ui';
import { useUserMutations, useUsers } from '../hooks/queries';
import { formatDateTime } from '../lib/format';

function CreateUserForm() {
  const { create } = useUserMutations();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('user');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      { username, password, role },
      {
        onSuccess: () => {
          setUsername('');
          setPassword('');
          setRole('user');
        },
      },
    );
  };

  return (
    <Card>
      <SectionTitle title="Add a user" description="Users can read, star and mark items as read. Admins can also manage sources, settings and users." />
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
        <Field label="Username">
          {(id) => <Input id={id} autoComplete="off" required value={username} onChange={(e) => setUsername(e.target.value)} />}
        </Field>
        <Field label="Password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
          {(id) => (
            <Input id={id} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>
        <Field label="Role">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="user">User (read only)</option>
              <option value="admin">Admin</option>
            </Select>
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add user'}</Button>
      </form>
      <div className="mt-3"><ErrorBanner error={create.error} /></div>
    </Card>
  );
}

function UserRow({ user, isSelf }: { user: UserDto; isSelf: boolean }) {
  const { update, remove } = useUserMutations();

  const resetPassword = () => {
    const password = window.prompt(`New password for "${user.username}" (at least ${MIN_PASSWORD_LENGTH} characters):`);
    if (password) update.mutate({ id: user.id, patch: { password } });
  };

  const deleteUser = () => {
    if (window.confirm(`Delete the account "${user.username}"? Their read and starred items are removed too.`)) {
      remove.mutate(user.id);
    }
  };

  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <span className="font-medium">{user.username}</span> {isSelf ? <Badge tone="accent">you</Badge> : null}
        <div className="mt-1"><ErrorBanner error={update.error ?? remove.error} /></div>
        {update.isSuccess && update.variables?.patch.password ? (
          <p role="status" className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">Password reset.</p>
        ) : null}
      </td>
      <td className="px-3 py-3">
        <Select
          aria-label={`Role of ${user.username}`}
          className="w-36"
          value={user.role}
          disabled={update.isPending}
          onChange={(e) => update.mutate({ id: user.id, patch: { role: e.target.value as UserRole } })}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </Select>
      </td>
      <td className="px-3 py-3 text-sm text-stone-500">{formatDateTime(user.createdAt)}</td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={resetPassword}>Reset password</Button>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={deleteUser} disabled={isSelf} title={isSelf ? 'You cannot delete your own account' : undefined}>
            Delete
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function UsersPage() {
  const me = useCurrentUser();
  const { data: users, isLoading, error } = useUsers();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        <h1 className="text-xl font-semibold">Users</h1>
        <CreateUserForm />
        <ErrorBanner error={error} />
        {isLoading ? <Spinner /> : null}
        {users ? (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <table className="w-full min-w-[640px] text-left">
              <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800">
                <tr>
                  {['User', 'Role', 'Created', ''].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                {users.map((user) => <UserRow key={user.id} user={user} isSelf={user.id === me.id} />)}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
