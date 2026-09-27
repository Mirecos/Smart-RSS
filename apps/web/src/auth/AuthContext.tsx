import type { UserDto } from '@smart-rss/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, ErrorBanner, Spinner } from '../components/ui';
import { queryKeys } from '../hooks/queries';
import { api, ApiError } from '../lib/api';
import { LoginPage } from '../pages/LoginPage';

const AuthContext = createContext<UserDto | null>(null);

/** The signed-in user. Only usable below <AuthGate>. */
export function useCurrentUser(): UserDto {
  const user = useContext(AuthContext);
  if (!user) throw new Error('useCurrentUser must be used inside <AuthGate>');
  return user;
}

export const useIsAdmin = (): boolean => useCurrentUser().role === 'admin';

/** Resolves the session; 401 means "signed out" rather than an error. */
async function fetchMe(): Promise<UserDto | null> {
  try {
    return await api.me();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** Shows the login page until a session exists, then renders the app with the current user in context. */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe, staleTime: Infinity, retry: false });

  if (me.isPending) {
    return <div className="grid h-full place-items-center"><Spinner label="Checking session" /></div>;
  }
  if (me.error) {
    return (
      <div className="mx-auto max-w-md space-y-3 p-8">
        <ErrorBanner error={me.error} />
        <Button onClick={() => void me.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!me.data) return <LoginPage />;
  return <AuthContext.Provider value={me.data}>{children}</AuthContext.Provider>;
}

/** Client-side guard for admin screens (the server enforces the same rule). */
export function RequireAdmin({ children }: { children: ReactNode }) {
  return useIsAdmin() ? <>{children}</> : <Navigate to="/" replace />;
}
