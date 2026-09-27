import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';

export const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700 shadow-sm',
  secondary:
    'border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800',
  ghost: 'text-stone-600 hover:bg-stone-200/60 dark:text-stone-300 dark:hover:bg-stone-800',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

const CONTROL =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-stone-400 ' +
  'focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 ' +
  'dark:border-stone-700 dark:bg-stone-900 dark:placeholder:text-stone-500 disabled:opacity-60';

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(CONTROL, className)} {...props} />
);

export const Textarea = ({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cn(CONTROL, 'font-mono text-xs', className)} {...props} />
);

export const Select = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn(CONTROL, 'pr-8', className)} {...props} />
);

/** Label + control + hint/error. The render prop receives the id to put on the control. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-stone-500 dark:text-stone-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-50')}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-5 w-9 rounded-full bg-stone-300 transition-colors after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:bg-accent-600 peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-accent-500 dark:bg-stone-700" />
      {label}
    </label>
  );
}

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const BADGE_TONES: Record<Tone, string> = {
  neutral: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  accent: 'bg-accent-100 text-accent-700 dark:bg-accent-700/30 dark:text-accent-500',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  danger: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

export const Badge = ({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) => (
  <span title={title} className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', BADGE_TONES[tone])}>
    {children}
  </span>
);

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <section className={cn('rounded-xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900', className)}>
    {children}
  </section>
);

export const SectionTitle = ({ title, description }: { title: string; description?: ReactNode }) => (
  <header className="mb-4">
    <h2 className="text-base font-semibold">{title}</h2>
    {description ? <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">{description}</p> : null}
  </header>
);

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <span role="status" aria-label={label} className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-accent-600" />
);

export const ErrorBanner = ({ error }: { error: unknown }) =>
  error ? (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;

export const EmptyState = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center text-stone-500 dark:text-stone-400">
    <p className="text-base font-medium text-stone-700 dark:text-stone-200">{title}</p>
    {children}
  </div>
);
