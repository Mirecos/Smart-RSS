import type { ItemDto } from '@smart-rss/shared';
import { useEffect, useRef } from 'react';
import { timeAgo } from '../../lib/format';
import { Button, EmptyState, ErrorBanner, Spinner, cn } from '../ui';

const SNIPPET_LENGTH = 160;

/** Plain-text snippet for list rows (React escapes it; no HTML is rendered here). */
export function snippet(html: string | null): string {
  if (!html) return '';
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text;
}

interface ItemListProps {
  items: ItemDto[];
  selectedId: number | null;
  onSelect: (item: ItemDto) => void;
  isLoading: boolean;
  error: unknown;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

export function ItemList({ items, selectedId, onSelect, isLoading, error, hasMore, loadingMore, onLoadMore }: ItemListProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId]);

  if (isLoading) {
    return <div className="flex justify-center p-8"><Spinner /></div>;
  }
  if (error) return <div className="p-4"><ErrorBanner error={error} /></div>;
  if (items.length === 0) {
    return <EmptyState title="Nothing to read here">New items appear as sources are refreshed.</EmptyState>;
  }

  return (
    <div>
      <ul aria-label="Items" className="divide-y divide-stone-200 dark:divide-stone-800">
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <li key={item.id}>
              <button
                ref={selected ? selectedRef : undefined}
                type="button"
                onClick={() => onSelect(item)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex w-full gap-3 px-4 py-3 text-left transition-colors',
                  selected ? 'bg-accent-50 dark:bg-accent-700/15' : 'hover:bg-stone-100 dark:hover:bg-stone-900',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                    {!item.isRead ? <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-accent-500" /> : null}
                    <span className="truncate">{item.sourceName}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={item.publishedAt ?? item.fetchedAt} className="shrink-0">
                      {timeAgo(item.publishedAt ?? item.fetchedAt)}
                    </time>
                    {item.isStarred ? <span aria-label="Starred" className="ml-auto text-amber-500">★</span> : null}
                  </div>
                  <p className={cn('mt-1 line-clamp-2 text-sm', item.isRead ? 'text-stone-500 dark:text-stone-400' : 'font-semibold')}>
                    {item.title}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-stone-500 dark:text-stone-400">
                    {snippet(item.summary ?? item.contentHtml)}
                  </p>
                </div>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {hasMore ? (
        <div className="flex justify-center p-4">
          <Button onClick={onLoadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</Button>
        </div>
      ) : null}
    </div>
  );
}
