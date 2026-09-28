import type { CategoryDto } from '@smart-rss/shared';
import { useState } from 'react';
import { useIsAdmin } from '../auth/AuthContext';
import { BASE_PATH } from '../lib/base';
import { Button, Card, ErrorBanner, Field, Input, SectionTitle, Select } from '../components/ui';
import { useCategories, useCategoryMutations, useSettings, useUpdateSettings } from '../hooks/queries';
import { applyTheme, readStored, THEME_KEY, writeStored, type Theme } from '../lib/storage';

function CategoryRow({ category }: { category: CategoryDto }) {
  const { rename, remove } = useCategoryMutations();
  const [name, setName] = useState(category.name);
  return (
    <li className="flex items-center gap-2">
      <Input aria-label={`Name of ${category.name}`} value={name} onChange={(e) => setName(e.target.value)} />
      <Button size="sm" disabled={!name.trim() || name === category.name} onClick={() => rename.mutate({ id: category.id, name })}>Rename</Button>
      <Button size="sm" variant="ghost" className="text-red-600"
        onClick={() => window.confirm(`Delete category "${category.name}"? Its sources are kept.`) && remove.mutate(category.id)}>
        Delete
      </Button>
      <ErrorBanner error={rename.error ?? remove.error} />
    </li>
  );
}

function CategoriesCard() {
  const { data: categories = [] } = useCategories();
  const { create } = useCategoryMutations();
  const [name, setName] = useState('');
  return (
    <Card>
      <SectionTitle title="Categories" description="Folders for your sources." />
      <ul className="space-y-2">{categories.map((c) => <CategoryRow key={`${c.id}:${c.name}`} category={c} />)}</ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim(), { onSuccess: () => setName('') });
        }}
      >
        <Input aria-label="New category name" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="primary" disabled={!name.trim()}>Add</Button>
      </form>
      <div className="mt-2"><ErrorBanner error={create.error} /></div>
    </Card>
  );
}

function ThemeCard() {
  const [theme, setTheme] = useState<Theme>(() => readStored<Theme>(THEME_KEY, 'system'));
  const onTheme = (value: Theme) => {
    setTheme(value);
    writeStored(THEME_KEY, value);
    applyTheme(value);
  };
  return (
    <Card>
      <SectionTitle title="Appearance" description="Saved in this browser." />
      <Field label="Theme" className="max-w-xs">
        {(id) => (
          <Select id={id} value={theme} onChange={(e) => onTheme(e.target.value as Theme)}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        )}
      </Field>
    </Card>
  );
}

function ServerSettingsCard() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  return (
    <Card>
      <SectionTitle title="Server settings" description="Apply to every user." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Keep items (days)" hint="Older items lose their content unless someone starred them. 0 = forever.">
          {(id) => (
            <Input id={id} type="number" min={0} max={3650} defaultValue={settings?.retentionDays} key={settings?.retentionDays}
              onBlur={(e) => update.mutate({ retentionDays: Number(e.target.value) })} />
          )}
        </Field>
        <Field label="Default refresh (minutes)" hint="Used for new and imported sources.">
          {(id) => (
            <Input id={id} type="number" min={5} defaultValue={settings?.defaultRefreshMinutes} key={settings?.defaultRefreshMinutes}
              onBlur={(e) => update.mutate({ defaultRefreshMinutes: Number(e.target.value) })} />
          )}
        </Field>
      </div>
      <div className="mt-3"><ErrorBanner error={update.error} /></div>
    </Card>
  );
}

export function SettingsPage() {
  const origin = window.location.origin;
  const isAdmin = useIsAdmin();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
        <h1 className="text-xl font-semibold">Settings</h1>
        <ThemeCard />
        {isAdmin ? (
          <>
            <ServerSettingsCard />
            <CategoriesCard />
          </>
        ) : null}
        <Card>
          <SectionTitle title="Output feeds" description="Subscribe to your aggregated items from any other reader." />
          <ul className="space-y-1 font-mono text-xs">
            {['all.rss', 'all.atom', 'all.json', 'category-ID.rss', 'source-ID.json'].map((file) => (
              <li key={file}>{origin}{BASE_PATH}/feeds/{file}</li>
            ))}
          </ul>
        </Card>
        <Card>
          <SectionTitle title="Keyboard shortcuts" />
          <dl className="grid grid-cols-[4rem_1fr] gap-y-1 text-sm">
            {[['j / k', 'Next / previous item'], ['m', 'Toggle read'], ['s', 'Toggle star'], ['o', 'Open original']].map(([key, action]) => (
              <div key={key} className="contents"><dt className="font-mono">{key}</dt><dd>{action}</dd></div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}
