import type { CategoryDto, ImportResult, SourceDto } from '@smart-rss/shared';
import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorBanner, Spinner } from '../components/ui';
import { useCategories, useDeleteSource, useImports, useRefreshSource, useSources, useToggleSource } from '../hooks/queries';
import { unwrapBackup } from '../lib/api';
import { formatInterval, timeAgo } from '../lib/format';

function HealthBadge({ source }: { source: SourceDto }) {
  const { health } = source;
  if (!source.enabled) return <Badge>Disabled</Badge>;
  if (health.pausedReason) return <Badge tone="danger" title={health.lastError ?? undefined}>Paused</Badge>;
  if (health.consecutiveFailures > 0) return <Badge tone="warning" title={health.lastError ?? undefined}>Failing ×{health.consecutiveFailures}</Badge>;
  if (!health.lastFetchedAt) return <Badge tone="accent">Pending</Badge>;
  return <Badge tone="success">OK</Badge>;
}

function SourceRow({ source, categories }: { source: SourceDto; categories: CategoryDto[] }) {
  const refresh = useRefreshSource();
  const toggle = useToggleSource();
  const remove = useDeleteSource();
  const category = categories.find((c) => c.id === source.categoryId);
  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <Link to={`/source/${source.id}`} className="font-medium hover:text-accent-700">{source.name}</Link>
        <p className="max-w-xs truncate text-xs text-stone-500">{source.url}</p>
        {source.health.lastError ? <p className="mt-1 max-w-xs text-xs text-red-600 dark:text-red-400">{source.health.lastError}</p> : null}
      </td>
      <td className="px-3 py-3"><Badge tone="accent">{source.config.parser.type.toUpperCase()}</Badge></td>
      <td className="px-3 py-3 text-sm">{category?.name ?? <span className="text-stone-400">—</span>}</td>
      <td className="px-3 py-3 text-sm">{formatInterval(source.refreshIntervalMinutes)}</td>
      <td className="px-3 py-3"><HealthBadge source={source} /></td>
      <td className="px-3 py-3 text-sm text-stone-500">{timeAgo(source.health.lastFetchedAt)}</td>
      <td className="px-3 py-3 text-sm tabular-nums">{source.unreadCount} / {source.totalCount}</td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" disabled={refresh.isPending} onClick={() => refresh.mutate(source.id)}>{refresh.isPending ? '…' : 'Refresh'}</Button>
          <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: source.id, enabled: !source.enabled })}>
            {source.enabled ? 'Disable' : source.health.pausedReason ? 'Resume' : 'Enable'}
          </Button>
          <Link to={`/sources/${source.id}/edit`} className="rounded-lg px-2.5 py-1 text-xs font-medium hover:bg-stone-200/60 dark:hover:bg-stone-800">Edit</Link>
          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => window.confirm(`Delete "${source.name}"?`) && remove.mutate(source.id)}>Delete</Button>
        </div>
      </td>
    </tr>
  );
}

function ImportExport({ isEmpty }: { isEmpty: boolean }) {
  const imports = useImports();
  const opmlInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = async (task: () => Promise<ImportResult>) => {
    setError(null);
    try {
      setResult(await task());
    } catch (e) {
      setError(e);
    }
  };

  const onFile = (kind: 'opml' | 'backup') => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await run(async () => {
      const text = await file.text();
      return kind === 'opml' ? imports.opml.mutateAsync(text) : imports.backup.mutateAsync(unwrapBackup(JSON.parse(text)));
    });
  };

  const addStarter = () => void run(() => imports.starter.mutateAsync());
  const starterLabel = imports.starter.isPending ? 'Adding…' : 'Add starter sources';

  return (
    <div className="space-y-2">
      {isEmpty ? (
        <EmptyState title="No sources yet">
          <p className="text-sm">Add an RSS/Atom feed, a JSON API or any web page — or start with a ready-made selection.</p>
          <Button variant="primary" className="mt-2" onClick={addStarter} disabled={imports.starter.isPending}>{starterLabel}</Button>
          <p className="text-xs">BBC, Le Monde, Hacker News, Ars Technica, The Verge, Daring Fireball, Node.js releases, GitHub Trending.</p>
        </EmptyState>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!isEmpty ? <Button size="sm" onClick={addStarter} disabled={imports.starter.isPending}>{starterLabel}</Button> : null}
        <Button size="sm" onClick={() => opmlInput.current?.click()}>Import OPML</Button>
        <a href="/api/opml" className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800">Export OPML</a>
        <Button size="sm" onClick={() => backupInput.current?.click()}>Restore backup</Button>
        <a href="/api/export" download="smart-rss-backup.json" className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800">Download backup</a>
        <input ref={opmlInput} type="file" accept=".opml,.xml,text/xml" hidden onChange={onFile('opml')} aria-label="OPML file" />
        <input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={onFile('backup')} aria-label="Backup file" />
      </div>
      <ErrorBanner error={error} />
      {result ? (
        <p role="status" className="text-sm text-stone-600 dark:text-stone-300">
          Imported {result.created}, skipped {result.skipped} existing{result.errors.length ? `, ${result.errors.length} errors: ${result.errors.slice(0, 3).join('; ')}` : ''}.
        </p>
      ) : null}
    </div>
  );
}

export function SourcesPage() {
  const { data: sources, isLoading, error } = useSources();
  const { data: categories = [] } = useCategories();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Sources</h1>
          <Link to="/sources/new" className="ml-auto rounded-lg bg-accent-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-700">+ Add source</Link>
        </div>
        <ImportExport isEmpty={sources?.length === 0} />
        <ErrorBanner error={error} />
        {isLoading ? <Spinner /> : null}
        {sources && sources.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <table className="w-full min-w-[900px] text-left">
              <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800">
                <tr>
                  {['Source', 'Type', 'Category', 'Every', 'Status', 'Last fetch', 'Unread / total', ''].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
                {sources.map((source) => <SourceRow key={source.id} source={source} categories={categories} />)}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
