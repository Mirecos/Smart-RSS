import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { cn } from './ui';

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex h-full">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-72 shrink-0 border-r border-stone-200 bg-stone-100 transition-transform dark:border-stone-800 dark:bg-stone-900',
          'md:static md:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <Sidebar onNavigate={() => setMenuOpen(false)} />
      </aside>
      {menuOpen ? (
        <div aria-hidden className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setMenuOpen(false)} />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-stone-200 px-3 py-2 md:hidden dark:border-stone-800">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            className="rounded-lg px-2 py-1 text-lg hover:bg-stone-200 dark:hover:bg-stone-800"
          >
            ☰
          </button>
          <span className="font-semibold">Smart RSS</span>
        </div>
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
