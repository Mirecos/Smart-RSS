import type { CategoryDto, SourceDto } from '@smart-rss/shared';
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useCurrentUser } from '../auth/AuthContext';
import { useCategories, useLogout, useSources } from '../hooks/queries';
import { cn } from './ui';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
    isActive
      ? 'bg-accent-100 font-medium text-accent-700 dark:bg-accent-700/20 dark:text-accent-500'
      : 'text-stone-700 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800',
  );

const Count = ({ value }: { value: number }) =>
  value > 0 ? <span className="text-xs tabular-nums text-stone-500 dark:text-stone-400">{value}</span> : null;

function SourceLink({ source }: { source: SourceDto }) {
  const failing = source.health.pausedReason || source.health.consecutiveFailures > 0;
  return (
    <NavLink to={`/source/${source.id}`} className={linkClass}>
      <span className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', failing ? 'bg-red-500' : source.enabled ? 'bg-emerald-500' : 'bg-stone-400')}
        />
        <span className={cn('truncate', !source.enabled && 'text-stone-400')}>{source.name}</span>
      </span>
      <Count value={source.unreadCount} />
    </NavLink>
  );
}

function CategoryGroup({ category, sources }: { category: CategoryDto; sources: SourceDto[] }) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <div className="flex items-center">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${category.name}`}
          onClick={() => setOpen(!open)}
          className="rounded p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
        >
          <span className={cn('inline-block text-[10px] transition-transform', open && 'rotate-90')}>▶</span>
        </button>
        <NavLink to={`/category/${category.id}`} className={(state) => cn(linkClass(state), 'flex-1')}>
          <span className="truncate">{category.name}</span>
          <Count value={category.unreadCount} />
        </NavLink>
      </div>
      {open && sources.length > 0 ? (
        <ul className="ml-5 mt-0.5 space-y-0.5">
          {sources.map((source) => (
            <li key={source.id}>
              <SourceLink source={source} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: sources = [] } = useSources();
  const { data: categories = [] } = useCategories();
  const totalUnread = sources.reduce((sum, s) => sum + s.unreadCount, 0);
  const uncategorized = sources.filter((s) => s.categoryId === null);
  const user = useCurrentUser();
  const isAdmin = user.role === 'admin';
  const logout = useLogout();

  return (
    <nav aria-label="Feeds" className="flex h-full flex-col gap-4 overflow-y-auto p-3" onClick={onNavigate}>
      <div className="flex items-center gap-2 px-2 pt-1">
        <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-accent-600 text-sm font-bold text-white">S</span>
        <span className="text-base font-semibold tracking-tight">Smart RSS</span>
      </div>

      <ul className="space-y-0.5">
        <li><NavLink end to="/" className={linkClass}><span>All items</span><Count value={totalUnread} /></NavLink></li>
        <li><NavLink to="/starred" className={linkClass}><span>Starred</span></NavLink></li>
      </ul>

      <div>
        <h3 className="px-2.5 pb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">Feeds</h3>
        <ul className="space-y-0.5">
          {categories.map((category) => (
            <CategoryGroup key={category.id} category={category} sources={sources.filter((s) => s.categoryId === category.id)} />
          ))}
          {uncategorized.map((source) => (
            <li key={source.id}><SourceLink source={source} /></li>
          ))}
        </ul>
        {sources.length === 0 ? <p className="px-2.5 text-sm text-stone-500">No sources yet.</p> : null}
      </div>

      <ul className="mt-auto space-y-0.5 border-t border-stone-200 pt-3 dark:border-stone-800">
        {isAdmin ? (
          <>
            <li><NavLink to="/sources/new" className={linkClass}>+ Add source</NavLink></li>
            <li><NavLink end to="/sources" className={linkClass}>Manage sources</NavLink></li>
            <li><NavLink to="/users" className={linkClass}>Users</NavLink></li>
          </>
        ) : null}
        <li><NavLink to="/settings" className={linkClass}>Settings</NavLink></li>
      </ul>

      <div className="flex items-center gap-2 rounded-lg bg-stone-200/60 px-2.5 py-2 dark:bg-stone-800/60">
        <NavLink to="/account" className="min-w-0 flex-1 truncate text-sm font-medium hover:text-accent-700" title="My account">
          {user.username}
        </NavLink>
        {isAdmin ? <span className="rounded-full bg-accent-100 px-1.5 text-[10px] font-semibold uppercase text-accent-700 dark:bg-accent-700/30 dark:text-accent-500">admin</span> : null}
        <button type="button" onClick={() => logout.mutate()} className="rounded px-1.5 py-0.5 text-xs text-stone-600 hover:bg-stone-300/60 dark:text-stone-300 dark:hover:bg-stone-700">
          Sign out
        </button>
      </div>
    </nav>
  );
}
