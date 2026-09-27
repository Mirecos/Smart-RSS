import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, ErrorBanner, Field, Input } from '../components/ui';
import { queryKeys, useLogin } from '../hooks/queries';
import { api } from '../lib/api';

export function LoginPage() {
  const status = useQuery({ queryKey: queryKeys.authStatus, queryFn: api.authStatus, retry: false });
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <main className="grid min-h-full place-items-center bg-stone-100 p-4 dark:bg-stone-950">
      <form
        onSubmit={handleSubmit}
        aria-labelledby="login-title"
        className="w-full max-w-sm space-y-5 rounded-2xl border border-stone-200 bg-white p-7 shadow-lg dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-10 w-10 place-items-center rounded-xl bg-accent-600 text-lg font-bold text-white">S</span>
          <div>
            <h1 id="login-title" className="text-lg font-semibold">Sign in to Smart RSS</h1>
            <p className="text-sm text-stone-500 dark:text-stone-400">Your feeds, your way.</p>
          </div>
        </div>

        {status.data && !status.data.hasUsers ? (
          <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            No account exists yet. Set <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> in the <code>.env</code> file,
            then restart the app (<code>scripts/restart</code>).
          </div>
        ) : null}

        <Field label="Username">
          {(id) => (
            <Input id={id} name="username" autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)} />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <Input id={id} name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          )}
        </Field>

        <ErrorBanner error={login.error} />
        <Button type="submit" variant="primary" className="w-full" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
