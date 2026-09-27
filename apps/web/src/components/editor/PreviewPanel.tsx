import type { Diagnostic, FetchOptions, ParsedItem, SourceConfigInput } from '@smart-rss/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import { snippet } from '../reader/ItemList';
import { Badge, Button, ErrorBanner, Spinner, Toggle, cn } from '../ui';

const AUTO_PREVIEW_DELAY_MS = 800;

const LEVEL_STYLES: Record<Diagnostic['level'], string> = {
  info: 'text-stone-600 dark:text-stone-300',
  warning: 'text-amber-700 dark:text-amber-400',
  error: 'text-red-700 dark:text-red-400',
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function PreviewItem({ item }: { item: ParsedItem }) {
  return (
    <li className="rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-700">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{item.title}</p>
          {item.link ? <p className="truncate font-mono text-xs text-accent-700 dark:text-accent-500">{item.link}</p> : <Badge tone="warning">no link</Badge>}
          <p className="mt-1 text-xs text-stone-500">
            {item.publishedAt ? formatDateTime(item.publishedAt) : 'no date'}
            {item.author ? ` · ${item.author}` : ''}
          </p>
          <p className="mt-1 line-clamp-3 text-xs text-stone-600 dark:text-stone-300">{snippet(item.content ?? item.summary) || <em>no content</em>}</p>
          {item.categories.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">{item.categories.map((c) => <Badge key={c}>{c}</Badge>)}</div>
          ) : null}
        </div>
        {item.image ? <img src={item.image} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded object-cover" /> : null}
      </div>
    </li>
  );
}

type Tab = 'items' | 'sample' | 'raw';

interface PreviewPanelProps {
  target: { url: string; config: SourceConfigInput } | null;
  fetchOptions: SourceConfigInput['fetch'];
}

export function PreviewPanel({ target, fetchOptions }: PreviewPanelProps) {
  const [auto, setAuto] = useState(true);
  const [tab, setTab] = useState<Tab>('items');
  const key = target ? JSON.stringify(target) : null;
  const debouncedKey = useDebouncedValue(key, AUTO_PREVIEW_DELAY_MS);
  const preview = useQuery({
    queryKey: ['preview', debouncedKey],
    queryFn: () => {
      const { url, config } = JSON.parse(debouncedKey as string) as { url: string; config: SourceConfigInput };
      return api.preview(url, config);
    },
    enabled: auto && debouncedKey !== null,
    staleTime: Infinity,
    retry: false,
  });
  const raw = useMutation({ mutationFn: () => api.raw(target?.url ?? '', (fetchOptions ?? {}) as Partial<FetchOptions>) });
  const result = preview.data;

  return (
    <div className="flex h-full flex-col rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 p-3 dark:border-stone-800">
        <h2 className="font-semibold">Live preview</h2>
        <Toggle label="Auto" checked={auto} onChange={setAuto} />
        <div className="ml-auto flex gap-2">
          <Button size="sm" disabled={!target || preview.isFetching} onClick={() => void preview.refetch()}>
            {preview.isFetching ? <Spinner label="Running preview" /> : 'Run preview'}
          </Button>
          <Button size="sm" variant="ghost" disabled={!target || raw.isPending} onClick={() => { setTab('raw'); raw.mutate(); }}>
            Fetch raw
          </Button>
        </div>
      </div>

      {!target ? (
        <p className="p-4 text-sm text-stone-500">Enter a valid URL and complete the format settings to see a preview.</p>
      ) : null}

      {result ? (
        <div className="space-y-2 border-b border-stone-200 p-3 text-sm dark:border-stone-800">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={result.ok ? 'success' : 'danger'}>{result.ok ? `${result.items.length} items` : 'Failed'}</Badge>
            {result.http.status ? <span className="text-xs text-stone-500">HTTP {result.http.status} · {formatBytes(result.http.bytes)} · {result.durationMs} ms</span> : null}
          </div>
          <ul aria-label="Diagnostics" className="space-y-0.5">
            {result.diagnostics.map((d, i) => (
              <li key={i} className={cn('text-xs', LEVEL_STYLES[d.level])}>
                <span className="font-mono uppercase opacity-70">[{d.stage}]</span> {d.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="px-3 pt-2"><ErrorBanner error={preview.error} /></div>

      <div role="tablist" className="flex gap-1 px-3 pt-2">
        {(['items', 'sample', 'raw'] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn('rounded-md px-2.5 py-1 text-xs font-medium', tab === t ? 'bg-stone-200 dark:bg-stone-800' : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800')}>
            {t === 'items' ? 'Items' : t === 'sample' ? 'Raw item' : 'Response'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'items' ? (
          <ul className="space-y-2">{result?.items.map((item) => <PreviewItem key={item.guid} item={item} />)}</ul>
        ) : null}
        {tab === 'sample' ? (
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 font-mono text-xs dark:bg-stone-950">
            {result?.sample ?? 'Run a preview to see the first item as parsed. Use it to write paths and selectors.'}
          </pre>
        ) : null}
        {tab === 'raw' ? (
          <div className="space-y-2">
            <ErrorBanner error={raw.error} />
            {raw.isPending ? <Spinner /> : null}
            {raw.data ? (
              <>
                <p className="text-xs text-stone-500">{raw.data.http.contentType ?? 'unknown type'} · {formatBytes(raw.data.http.bytes)}{raw.data.truncated ? ' · truncated' : ''}</p>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-stone-100 p-3 font-mono text-xs dark:bg-stone-950">{raw.data.body}</pre>
              </>
            ) : !raw.isPending ? <p className="text-sm text-stone-500">Click "Fetch raw" to see the response body.</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
