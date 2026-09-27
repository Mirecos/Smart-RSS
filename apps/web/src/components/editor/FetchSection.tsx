import type { SourceConfigInput } from '@smart-rss/shared';
import { useState } from 'react';
import { setIn, type Issues } from '../../lib/draft';
import { Card, Field, Input, SectionTitle, Select, Textarea, Toggle } from '../ui';

export function headersToText(headers: Record<string, string> | undefined): string {
  return Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

export function textToHeaders(text: string): Record<string, string> {
  const entries = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(':'))
    .map((line) => {
      const index = line.indexOf(':');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
    })
    .filter(([name]) => name.length > 0);
  return Object.fromEntries(entries);
}

interface FetchSectionProps {
  config: SourceConfigInput;
  onChange: (config: SourceConfigInput) => void;
  issues: Issues;
  rendererAvailable: boolean;
}

export function FetchSection({ config, onChange, issues, rendererAvailable }: FetchSectionProps) {
  const fetch = config.fetch ?? {};
  const [headersText, setHeadersText] = useState(() => headersToText(fetch.headers));
  const set = (key: string, value: unknown) => onChange(setIn(config, ['fetch', key], value));
  const headerIssue = Object.entries(issues).find(([key]) => key.startsWith('config.fetch.headers'))?.[1];

  return (
    <Card>
      <SectionTitle title="Request" description="Customize how the source is downloaded." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Method">
          {(id) => (
            <Select id={id} value={fetch.method ?? 'GET'} onChange={(e) => set('method', e.target.value)}>
              <option>GET</option>
              <option>POST</option>
            </Select>
          )}
        </Field>
        <Field label="Timeout (seconds)" error={issues['config.fetch.timeoutMs']}>
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={60}
              value={Math.round((fetch.timeoutMs ?? 15_000) / 1000)}
              onChange={(e) => set('timeoutMs', Number(e.target.value) * 1000)}
            />
          )}
        </Field>
        <Field label="User agent" className="sm:col-span-2" hint="Leave empty for the default SmartRSS user agent.">
          {(id) => <Input id={id} value={fetch.userAgent ?? ''} onChange={(e) => set('userAgent', e.target.value || undefined)} />}
        </Field>
        <Field label="Headers" className="sm:col-span-2" error={headerIssue} hint="One per line, e.g. Authorization: Bearer abc123">
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={headersText}
              onChange={(e) => {
                setHeadersText(e.target.value);
                set('headers', textToHeaders(e.target.value));
              }}
            />
          )}
        </Field>
        {fetch.method === 'POST' ? (
          <Field label="Request body" className="sm:col-span-2">
            {(id) => <Textarea id={id} rows={4} value={fetch.body ?? ''} onChange={(e) => set('body', e.target.value || undefined)} />}
          </Field>
        ) : null}
        <div className="sm:col-span-2">
          <Toggle
            label="Render JavaScript (headless Chromium)"
            checked={Boolean(fetch.render)}
            onChange={(value) => set('render', value)}
            disabled={!rendererAvailable && !fetch.render}
          />
          <p className="mt-1 text-xs text-stone-500">
            {rendererAvailable
              ? 'For pages that build their content with JavaScript. Slower; use only when needed.'
              : 'Renderer not running. Start it with: docker compose --profile js up -d'}
          </p>
        </div>
      </div>
    </Card>
  );
}
