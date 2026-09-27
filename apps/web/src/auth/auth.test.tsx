import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate, useCurrentUser } from './AuthContext';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown) => json(200, { success: true, data, error: null });
const fail = (status: number, message: string) => json(status, { success: false, data: null, error: { message } });

const ADMIN = { id: 1, username: 'admin', role: 'admin', createdAt: '2024-01-01T00:00:00.000Z' };

function Whoami() {
  const user = useCurrentUser();
  return <p>Signed in as {user.username}</p>;
}

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthGate>
        <Whoami />
      </AuthGate>
    </QueryClientProvider>,
  );
}

describe('AuthGate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the app directly when a session exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(ADMIN)));

    renderGate();

    expect(await screen.findByText('Signed in as admin')).toBeInTheDocument();
  });

  it('shows the login page, reports bad credentials, then signs in', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/me') return fail(401, 'Authentication required');
      if (url === '/api/auth/status') return ok({ hasUsers: true });
      const body = JSON.parse(String(init?.body)) as { password: string };
      return body.password === 'right-password' ? ok(ADMIN) : fail(401, 'Invalid username or password');
    });
    vi.stubGlobal('fetch', fetchMock);
    renderGate();

    await screen.findByRole('heading', { name: 'Sign in to Smart RSS' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid username or password')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Signed in as admin')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
  });

  it('explains how to create the first admin when no account exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/auth/status' ? ok({ hasUsers: false }) : fail(401, 'Authentication required'))));

    renderGate();

    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent('ADMIN_USERNAME'));
  });

  it('offers a retry when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));

    renderGate();

    expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
