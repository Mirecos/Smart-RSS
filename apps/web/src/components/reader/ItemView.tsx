import type { ItemDto } from '@smart-rss/shared';
import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import { formatDateTime, hostname } from '../../lib/format';
import { Badge, Button, EmptyState } from '../ui';

/** Content is sanitized on the server; DOMPurify is a second, client-side layer of defence. */
export function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input'] });
}

interface ItemViewProps {
  item: ItemDto | null;
  onToggleRead: (item: ItemDto) => void;
  onToggleStar: (item: ItemDto) => void;
  onBack?: () => void;
}

export function ItemView({ item, onToggleRead, onToggleStar, onBack }: ItemViewProps) {
  const html = useMemo(() => {
    const source = item?.contentHtml ?? item?.summary;
    return source ? safeHtml(source) : '';
  }, [item?.contentHtml, item?.summary]);

  if (!item) {
    return (
      <EmptyState title="Select an item">
        <p className="text-sm">
          Keyboard: <kbd>j</kbd>/<kbd>k</kbd> next/previous · <kbd>m</kbd> read · <kbd>s</kbd> star · <kbd>o</kbd> open
        </p>
      </EmptyState>
    );
  }

  const showHeroImage = item.imageUrl && !html.includes('<img');

  return (
    <article className="mx-auto max-w-3xl px-6 py-8">
      {onBack ? (
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-4 md:hidden">← Back</Button>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-2 text-sm text-stone-500 dark:text-stone-400">
        <span className="font-medium text-accent-700 dark:text-accent-500">{item.sourceName}</span>
        {item.author ? <span>· {item.author}</span> : null}
        <span>· {formatDateTime(item.publishedAt ?? item.fetchedAt)}</span>
      </div>
      <h1 className="mt-2 text-2xl font-bold leading-tight tracking-tight md:text-3xl">
        {item.link ? (
          <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:text-accent-700">{item.title}</a>
        ) : (
          item.title
        )}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => onToggleStar(item)} aria-pressed={item.isStarred}>
          {item.isStarred ? '★ Starred' : '☆ Star'}
        </Button>
        <Button size="sm" onClick={() => onToggleRead(item)}>{item.isRead ? 'Mark unread' : 'Mark read'}</Button>
        {item.link ? (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Open on {hostname(item.link)} ↗
          </a>
        ) : null}
        {item.categories.map((category) => <Badge key={category}>{category}</Badge>)}
      </div>
      {showHeroImage ? (
        <img src={item.imageUrl ?? ''} alt="" referrerPolicy="no-referrer" className="mt-6 max-h-96 w-full rounded-xl object-cover" />
      ) : null}
      {html ? (
        <div className="article-content mt-6" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="mt-6 text-stone-500">This item has no content. Open the original page to read it.</p>
      )}
    </article>
  );
}
