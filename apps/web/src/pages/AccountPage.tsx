import { MIN_PASSWORD_LENGTH } from '@smart-rss/shared';
import { useState, type FormEvent } from 'react';
import { useCurrentUser } from '../auth/AuthContext';
import { Badge, Button, Card, ErrorBanner, Field, Input, SectionTitle } from '../components/ui';
import { useChangePassword, useLogout } from '../hooks/queries';

export function AccountPage() {
  const user = useCurrentUser();
  const changePassword = useChangePassword();
  const logout = useLogout();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const mismatch = confirmation.length > 0 && confirmation !== newPassword;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (mismatch) return;
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          setConfirmation('');
        },
      },
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
        <h1 className="text-xl font-semibold">My account</h1>
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-base font-medium">{user.username}</span>
            <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role === 'admin' ? 'Admin' : 'User'}</Badge>
            <Button className="ml-auto" onClick={() => logout.mutate()} disabled={logout.isPending}>Sign out</Button>
          </div>
        </Card>
        <Card>
          <SectionTitle title="Change password" description="Your other sessions are signed out after the change." />
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Current password">
              {(id) => <Input id={id} type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />}
            </Field>
            <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
              {(id) => <Input id={id} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />}
            </Field>
            <Field label="Confirm new password" error={mismatch ? 'Passwords do not match' : undefined}>
              {(id) => <Input id={id} type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />}
            </Field>
            <ErrorBanner error={changePassword.error} />
            {changePassword.isSuccess ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">Password changed.</p> : null}
            <Button type="submit" variant="primary" disabled={changePassword.isPending || mismatch}>
              {changePassword.isPending ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
