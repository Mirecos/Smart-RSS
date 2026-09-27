import type { CategoryDto } from '@smart-rss/shared';
import { MAX_REFRESH_MINUTES, MIN_REFRESH_MINUTES } from '@smart-rss/shared';
import type { SourceDraft, Issues } from '../../lib/draft';
import { hostname } from '../../lib/format';
import { PRESETS, type Preset } from '../../lib/presets';
import { Card, Field, Input, SectionTitle, Select, Toggle, cn } from '../ui';

const INTERVALS = [15, 30, 60, 180, 360, 720, 1440];

interface GeneralSectionProps {
  draft: SourceDraft;
  onChange: (draft: SourceDraft) => void;
  categories: CategoryDto[];
  issues: Issues;
  showPresets: boolean;
  onPreset: (preset: Preset) => void;
}

export function GeneralSection({ draft, onChange, categories, issues, showPresets, onPreset }: GeneralSectionProps) {
  const set = <K extends keyof SourceDraft>(key: K, value: SourceDraft[K]) => onChange({ ...draft, [key]: value });
  const intervalOptions = INTERVALS.includes(draft.refreshIntervalMinutes)
    ? INTERVALS
    : [...INTERVALS, draft.refreshIntervalMinutes].sort((a, b) => a - b);

  return (
    <Card>
      <SectionTitle title="Source" description="Where to fetch from and how often." />
      {showPresets ? (
        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Start from a template</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onPreset(preset)}
                className={cn(
                  'rounded-lg border border-stone-200 p-3 text-left text-sm transition-colors hover:border-accent-500 hover:bg-accent-50',
                  'dark:border-stone-700 dark:hover:bg-accent-700/10',
                )}
              >
                <span className="font-medium">{preset.label}</span>
                <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{preset.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="URL" error={issues.url} className="sm:col-span-2" hint="Feed, JSON endpoint or web page address.">
          {(id) => (
            <Input
              id={id}
              type="url"
              placeholder="https://example.com/feed.xml"
              value={draft.url}
              onChange={(e) => set('url', e.target.value)}
            />
          )}
        </Field>
        <Field label="Name" error={issues.name} hint="Defaults to the site's host name.">
          {(id) => (
            <Input id={id} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder={hostname(draft.url) || 'My favourite blog'} />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={draft.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Refresh every" error={issues.refreshIntervalMinutes} hint={`Between ${MIN_REFRESH_MINUTES} minutes and ${MAX_REFRESH_MINUTES / 1440} days.`}>
          {(id) => (
            <Select id={id} value={draft.refreshIntervalMinutes} onChange={(e) => set('refreshIntervalMinutes', Number(e.target.value))}>
              {intervalOptions.map((m) => (
                <option key={m} value={m}>{m < 60 ? `${m} minutes` : m < 1440 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m / 1440} day${m === 1440 ? '' : 's'}`}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex items-end pb-2">
          <Toggle label="Enabled (fetched automatically)" checked={draft.enabled} onChange={(value) => set('enabled', value)} />
        </div>
      </div>
    </Card>
  );
}
