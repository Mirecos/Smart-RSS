import { ITEM_FIELDS, type ItemField, type SourceConfigInput } from '@smart-rss/shared';
import { setFieldRule, type Issues } from '../../lib/draft';
import { Input } from '../ui';

const FIELD_LABELS: Record<ItemField, string> = {
  id: 'Unique id',
  title: 'Title',
  link: 'Link',
  content: 'Content',
  summary: 'Summary',
  author: 'Author',
  publishedAt: 'Date',
  image: 'Image',
  categories: 'Categories',
};

const PLACEHOLDERS: Record<'xml' | 'json' | 'css' | 'xpath', Partial<Record<ItemField, string>>> = {
  xml: { title: 'auto', link: 'auto', content: 'auto (e.g. content.encoded)', image: 'auto (e.g. media.thumbnails[0].url)' },
  json: { id: 'auto (id, guid…)', title: 'auto (title, name…)', link: 'auto (url, link…)', publishedAt: 'auto (date, published_at…)' },
  css: { title: 'h1, h2, h3, h4, a', link: 'a[href]', summary: 'p', image: 'img[src]', publishedAt: 'time[datetime]', content: 'e.g. . (the item itself)' },
  xpath: { title: '(.//h2)[1]', link: '(.//a/@href)[1]', summary: '(.//p)[1]', image: '(.//img/@src)[1]' },
};

export function FieldMapEditor({ config, onChange, issues }: { config: SourceConfigInput; onChange: (c: SourceConfigInput) => void; issues: Issues }) {
  const parser = config.parser;
  const fields = parser.fields ?? {};
  const isHtml = parser.type === 'html';
  const placeholderSet = isHtml ? (parser.selectorType === 'xpath' ? 'xpath' : 'css') : parser.type;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-stone-500">
            <th className="py-1 pr-2 font-semibold">Field</th>
            <th className="py-1 pr-2 font-semibold">{isHtml ? (parser.selectorType === 'xpath' ? 'XPath' : 'CSS selector') : 'JSONPath'}</th>
            <th className="py-1 font-semibold">{isHtml ? 'Attribute' : ''}</th>
          </tr>
        </thead>
        <tbody>
          {ITEM_FIELDS.map((field) => {
            const rule = fields[field];
            const error = issues[`config.parser.fields.${field}.path`] ?? issues[`config.parser.fields.${field}.attr`];
            const update = (patch: Record<string, string>) =>
              onChange(setFieldRule(config, field, { path: rule?.path ?? '', ...rule, ...patch }));
            return (
              <tr key={field} className="align-top">
                <td className="py-1 pr-2 pt-3 font-medium whitespace-nowrap">{FIELD_LABELS[field]}</td>
                <td className="py-1 pr-2">
                  <Input
                    aria-label={`${FIELD_LABELS[field]} path`}
                    className="font-mono text-xs"
                    placeholder={PLACEHOLDERS[placeholderSet][field] ?? (isHtml ? '' : 'auto')}
                    value={rule?.path ?? ''}
                    onChange={(e) => update({ path: e.target.value })}
                  />
                  {field === 'publishedAt' && rule?.path ? (
                    <Input
                      aria-label="Date format"
                      className="mt-1 font-mono text-xs"
                      placeholder="Date format, e.g. dd/MM/yyyy HH:mm (optional)"
                      value={rule.dateFormat ?? ''}
                      onChange={(e) => update({ dateFormat: e.target.value })}
                    />
                  ) : null}
                  {error ? <p role="alert" className="mt-1 text-xs text-red-600">{error}</p> : null}
                </td>
                <td className="py-1">
                  {isHtml && parser.selectorType !== 'xpath' ? (
                    <Input
                      aria-label={`${FIELD_LABELS[field]} attribute`}
                      className="w-28 font-mono text-xs"
                      placeholder="text"
                      value={rule?.attr ?? ''}
                      disabled={!rule?.path}
                      onChange={(e) => update({ attr: e.target.value })}
                    />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
        {isHtml
          ? parser.selectorType === 'xpath'
            ? 'XPath is evaluated relative to each item. Use @attr or string(...) to extract values.'
            : 'Selectors are relative to each item ("." = the item itself). Attribute: text (default), html, or any attribute name such as href or src.'
          : 'Paths are evaluated against each parsed item; see "Raw item" in the preview for the available keys. Empty = automatic.'}
      </p>
    </div>
  );
}
