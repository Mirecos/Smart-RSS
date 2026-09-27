import type { ItemDto } from '@smart-rss/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ItemList } from '../components/reader/ItemList';
import { ItemView } from '../components/reader/ItemView';
import { Button, Input, Toggle, cn } from '../components/ui';
import { useIsAdmin } from '../auth/AuthContext';
import { useCategories, useItems, useMarkRead, useRefreshSource, useSources, useUpdateItem } from '../hooks/queries';
import type { ItemFilter } from '../lib/api';
import { readStored, writeStored } from '../lib/storage';

export type ReaderMode = 'all' | 'starred' | 'category' | 'source';

const UNREAD_ONLY_KEY = 'smart-rss:unread-only';
const SEARCH_DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

export function ReaderPage({ mode }: { mode: ReaderMode }) {
  const params = useParams();
  const scopeId = params.id ? Number(params.id) : undefined;
  const { data: sources = [] } = useSources();
  const { data: categories = [] } = useCategories();
  const [unreadOnly, setUnreadOnly] = useState(() => readStored(UNREAD_ONLY_KEY, false));
  const [search, setSearch] = useState('');
  const q = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const filter: ItemFilter = useMemo(
    () => ({
      starred: mode === 'starred' || undefined,
      categoryId: mode === 'category' ? scopeId : undefined,
      sourceId: mode === 'source' ? scopeId : undefined,
      unread: (unreadOnly && mode !== 'starred') || undefined,
      q: q || undefined,
    }),
    [mode, scopeId, unreadOnly, q],
  );
  const query = useItems(filter);
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const updateItem = useUpdateItem();
  const markRead = useMarkRead();
  const refresh = useRefreshSource();
  const isAdmin = useIsAdmin();

  useEffect(() => setSelectedId(null), [mode, scopeId]);

  const source = mode === 'source' ? sources.find((s) => s.id === scopeId) : undefined;
  const title =
    mode === 'starred' ? 'Starred'
    : mode === 'category' ? (categories.find((c) => c.id === scopeId)?.name ?? 'Category')
    : mode === 'source' ? (source?.name ?? 'Source')
    : 'All items';

  const select = useCallback(
    (item: ItemDto) => {
      setSelectedId(item.id);
      if (!item.isRead) updateItem.mutate({ id: item.id, patch: { isRead: true } });
    },
    [updateItem],
  );
  const toggleRead = (item: ItemDto) => updateItem.mutate({ id: item.id, patch: { isRead: !item.isRead } });
  const toggleStar = (item: ItemDto) => updateItem.mutate({ id: item.id, patch: { isStarred: !item.isStarred } });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = items.findIndex((item) => item.id === selectedId);
      const move = (delta: number) => {
        const next = items[Math.min(Math.max(index + delta, 0), items.length - 1)];
        if (next) select(next);
      };
      if (event.key === 'j') move(index === -1 ? 0 : 1);
      else if (event.key === 'k') move(-1);
      else if (event.key === 'm' && selected) toggleRead(selected);
      else if (event.key === 's' && selected) toggleStar(selected);
      else if (event.key === 'o' && selected?.link) window.open(selected.link, '_blank', 'noopener,noreferrer');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggleUnreadOnly = (value: boolean) => {
    setUnreadOnly(value);
    writeStored(UNREAD_ONLY_KEY, value);
  };

  return (
    <div className="grid h-full md:grid-cols-[minmax(320px,420px)_1fr]">
      <section className={cn('flex min-h-0 flex-col border-r border-stone-200 dark:border-stone-800', selected && 'hidden md:flex')}>
        <header className="space-y-3 border-b border-stone-200 p-4 dark:border-stone-800">
          <div className="flex items-center justify-between gap-2">
            <h1 className="truncate text-lg font-semibold">{title}</h1>
            <div className="flex shrink-0 gap-1">
              {source && isAdmin ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => refresh.mutate(source.id)} disabled={refresh.isPending}>
                    {refresh.isPending ? 'Refreshing…' : 'Refresh'}
                  </Button>
                  <Link to={`/sources/${source.id}/edit`} className="rounded-lg px-2.5 py-1 text-xs font-medium hover:bg-stone-200/60 dark:hover:bg-stone-800">Edit</Link>
                </>
              ) : null}
              {mode !== 'starred' ? (
                <Button size="sm" variant="ghost" onClick={() => markRead.mutate({ sourceId: filter.sourceId, categoryId: filter.categoryId })}>
                  Mark all read
                </Button>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Input type="search" placeholder="Search…" aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} />
            {mode !== 'starred' ? <Toggle label="Unread" checked={unreadOnly} onChange={toggleUnreadOnly} /> : null}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ItemList
            items={items}
            selectedId={selectedId}
            onSelect={select}
            isLoading={query.isLoading}
            error={query.error}
            hasMore={Boolean(query.hasNextPage)}
            loadingMore={query.isFetchingNextPage}
            onLoadMore={() => void query.fetchNextPage()}
          />
        </div>
      </section>
      <section className={cn('min-h-0 overflow-y-auto', !selected && 'hidden md:block')}>
        <ItemView item={selected} onToggleRead={toggleRead} onToggleStar={toggleStar} onBack={() => setSelectedId(null)} />
      </section>
    </div>
  );
}
