import { SOURCE_TYPES, type SourceConfigInput, type SourceType } from '@smart-rss/shared';
import { changeParserType, setIn, type Issues } from '../../lib/draft';
import { Card, Field, Input, SectionTitle, Select, cn } from '../ui';
import { FieldMapEditor } from './FieldMapEditor';

const TYPE_INFO: Record<SourceType, { label: string; description: string }> = {
  xml: { label: 'XML feed', description: 'RSS, Atom or RDF' },
  json: { label: 'JSON', description: 'JSON Feed or any JSON API' },
  html: { label: 'HTML page', description: 'Scrape with CSS / XPath' },
};

interface SectionProps {
  config: SourceConfigInput;
  onChange: (config: SourceConfigInput) => void;
  issues: Issues;
}

export function ParserSection({ config, onChange, issues }: SectionProps) {
  const parser = config.parser;
  return (
    <Card>
      <SectionTitle title="Format" description="How items are found in the response and mapped to fields." />
      <div role="radiogroup" aria-label="Source type" className="mb-5 grid grid-cols-3 gap-2">
        {SOURCE_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={parser.type === type}
            onClick={() => onChange(changeParserType(config, type))}
            className={cn(
              'rounded-lg border p-3 text-left text-sm transition-colors',
              parser.type === type
                ? 'border-accent-500 bg-accent-50 ring-2 ring-accent-500/30 dark:bg-accent-700/10'
                : 'border-stone-200 hover:border-stone-400 dark:border-stone-700',
            )}
          >
            <span className="font-medium">{TYPE_INFO[type].label}</span>
            <span className="block text-xs text-stone-500 dark:text-stone-400">{TYPE_INFO[type].description}</span>
          </button>
        ))}
      </div>

      {parser.type === 'json' ? (
        <Field label="Items path (JSONPath)" className="mb-5" error={issues['config.parser.itemsPath']} hint="Empty for JSON Feed documents. Examples: $.items[*], $.data.posts">
          {(id) => (
            <Input id={id} className="font-mono text-xs" value={parser.itemsPath ?? ''} placeholder="$.items[*]"
              onChange={(e) => onChange(setIn(config, ['parser', 'itemsPath'], e.target.value))} />
          )}
        </Field>
      ) : null}

      {parser.type === 'html' ? (
        <div className="mb-5 grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field label="Selector type">
            {(id) => (
              <Select id={id} value={parser.selectorType ?? 'css'} onChange={(e) => onChange(setIn(config, ['parser', 'selectorType'], e.target.value))}>
                <option value="css">CSS</option>
                <option value="xpath">XPath</option>
              </Select>
            )}
          </Field>
          <Field label="Item selector" error={issues['config.parser.itemSelector']} hint="Matches one element per item, e.g. article.post or //div[@class='entry']">
            {(id) => (
              <Input id={id} className="font-mono text-xs" value={parser.itemSelector}
                onChange={(e) => onChange(setIn(config, ['parser', 'itemSelector'], e.target.value))} />
            )}
          </Field>
        </div>
      ) : null}

      <FieldMapEditor config={config} onChange={onChange} issues={issues} />
    </Card>
  );
}

export function EnrichmentSection({ config, onChange, issues }: SectionProps) {
  const fullText = config.fullText ?? {};
  return (
    <Card>
      <SectionTitle title="Full text & duplicates" description="Fetch the complete article for sources that only publish excerpts." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full-text extraction" hint="Runs for new items only (at most 20 per refresh).">
          {(id) => (
            <Select id={id} value={fullText.mode ?? 'off'} onChange={(e) => onChange(setIn(config, ['fullText', 'mode'], e.target.value))}>
              <option value="off">Off (use the source content)</option>
              <option value="readability">Automatic (Readability)</option>
              <option value="selector">CSS selector on the article page</option>
            </Select>
          )}
        </Field>
        {fullText.mode === 'selector' ? (
          <Field label="Article selector" error={issues['config.fullText.selector']}>
            {(id) => (
              <Input id={id} className="font-mono text-xs" placeholder=".article-body" value={fullText.selector ?? ''}
                onChange={(e) => onChange(setIn(config, ['fullText', 'selector'], e.target.value))} />
            )}
          </Field>
        ) : null}
        <Field label="Detect duplicates by" hint="Change if a source reuses ids or rewrites links.">
          {(id) => (
            <Select id={id} value={config.dedupeBy ?? 'guid'} onChange={(e) => onChange(setIn(config, ['dedupeBy'], e.target.value))}>
              <option value="guid">Item id (falls back to link)</option>
              <option value="link">Link</option>
              <option value="titleHash">Title</option>
            </Select>
          )}
        </Field>
      </div>
    </Card>
  );
}
