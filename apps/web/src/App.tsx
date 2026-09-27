import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthGate, RequireAdmin } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { AccountPage } from './pages/AccountPage';
import { ReaderPage } from './pages/ReaderPage';
import { SettingsPage } from './pages/SettingsPage';
import { SourceEditorPage } from './pages/SourceEditorPage';
import { SourcesPage } from './pages/SourcesPage';
import { UsersPage } from './pages/UsersPage';

/** Remounts the editor per source so drafts never leak between sources. */
function EditSourceRoute() {
  const { id } = useParams();
  return <SourceEditorPage key={id} />;
}

const admin = (page: ReactNode) => <RequireAdmin>{page}</RequireAdmin>;

export function App() {
  return (
    <AuthGate>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ReaderPage mode="all" />} />
          <Route path="starred" element={<ReaderPage mode="starred" />} />
          <Route path="category/:id" element={<ReaderPage key="category" mode="category" />} />
          <Route path="source/:id" element={<ReaderPage key="source" mode="source" />} />
          <Route path="sources" element={admin(<SourcesPage />)} />
          <Route path="sources/new" element={admin(<SourceEditorPage key="new" />)} />
          <Route path="sources/:id/edit" element={admin(<EditSourceRoute />)} />
          <Route path="users" element={admin(<UsersPage />)} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}
