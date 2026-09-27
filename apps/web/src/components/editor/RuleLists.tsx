import {
  FILTERABLE_FIELDS,
  TRANSFORMABLE_FIELDS,
  type Filter,
  type SourceConfigInput,
  type Transform,
  type TransformOp,
} from '@smart-rss/shared';
import { setIn, type Issues } from '../../lib/draft';
import { Button, Card, Input, SectionTitle, Select } from '../ui';

type TransformInput = NonNullable<SourceConfigInput['transforms']>[number];
type FilterInput = NonNullable<SourceConfigInput['filters']>[number];

const OP_LABELS: Record<TransformOp, string> = {
  regexReplace: 'Replace (regex)',
  stripHtml: 'Strip HTML',
  trim: 'Trim whitespace',
  truncate: 'Truncate',
  defaultValue: 'Default value',
};

export function newTransform(op: TransformOp, field: Transform['field'] = 'title'): TransformInput {
  switch (op) {
    case 'regexReplace':
      return { op, field, pattern: '', flags: 'g', replacement: '' };
    case 'truncate':
      return { op, field, length: 200 };
    case 'defaultValue':
      return { op, field, value: '' };
    default:
      return { op, field };
  }
}

interface ListProps {
  config: SourceConfigInput;
  onChange: (config: SourceConfigInput) => void;
  issues: Issues;
}

const rowError = (issues: Issues, prefix: string) =>
  Object.entries(issues).find(([key]) => key.startsWith(prefix))?.[1];

function TransformRow({ transform, index, list, config, onChange, issues }: ListProps & { transform: TransformInput; index: number; list: TransformInput[] }) {
  const replace = (next: TransformInput) => onChange({ ...config, transforms: list.map((t, i) => (i === index ? next : t)) });
  const set = (key: string, value: unknown) => onChange(setIn(config, ['transforms', index, key], value));
  const error = rowError(issues, `config.transforms.${index}.`);
  return (
    <li className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Operation" className="w-44" value={transform.op} onChange={(e) => replace(newTransform(e.target.value as TransformOp, transform.field))}>
          {Object.entries(OP_LABELS).map(([op, label]) => <option key={op} value={op}>{label}</option>)}
        </Select>
        <span className="text-sm text-stone-500">on</span>
        <Select aria-label="Field" className="w-36" value={transform.field} onChange={(e) => set('field', e.target.value)}>
          {TRANSFORMABLE_FIELDS.map((f) => <option key={f}>{f}</option>)}
        </Select>
        {transform.op === 'truncate' ? (
          <Input aria-label="Length" type="number" min={1} className="w-28" value={transform.length} onChange={(e) => set('length', Number(e.target.value))} />
        ) : null}
        {transform.op === 'defaultValue' ? (
          <Input aria-label="Default value" className="flex-1" value={transform.value} onChange={(e) => set('value', e.target.value)} />
        ) : null}
        <Button size="sm" variant="ghost" className="ml-auto" aria-label="Remove transform" onClick={() => onChange({ ...config, transforms: list.filter((_, i) => i !== index) })}>✕</Button>
      </div>
      {transform.op === 'regexReplace' ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_5rem_1fr]">
          <Input aria-label="Pattern" className="font-mono text-xs" placeholder="Pattern, e.g. ^\[AD\]\s*" value={transform.pattern} onChange={(e) => set('pattern', e.target.value)} />
          <Input aria-label="Flags" className="font-mono text-xs" placeholder="g" value={transform.flags ?? ''} onChange={(e) => set('flags', e.target.value)} />
          <Input aria-label="Replacement" className="font-mono text-xs" placeholder="Replacement ($1 allowed)" value={transform.replacement ?? ''} onChange={(e) => set('replacement', e.target.value)} />
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-1 text-xs text-red-600">{error}</p> : null}
    </li>
  );
}

export function TransformList({ config, onChange, issues }: ListProps) {
  const list = config.transforms ?? [];
  return (
    <Card>
      <SectionTitle title="Transforms" description="Rewrite extracted values before they are stored (applied in order)." />
      <ol className="space-y-2">
        {list.map((transform, index) => (
          <TransformRow key={index} transform={transform} index={index} list={list} config={config} onChange={onChange} issues={issues} />
        ))}
      </ol>
      <Button size="sm" className="mt-3" onClick={() => onChange({ ...config, transforms: [...list, newTransform('regexReplace')] })}>
        + Add transform
      </Button>
    </Card>
  );
}

export function FilterList({ config, onChange, issues }: ListProps) {
  const list: FilterInput[] = config.filters ?? [];
  const set = (index: number, key: keyof Filter, value: unknown) => onChange(setIn(config, ['filters', index, key], value));
  return (
    <Card>
      <SectionTitle title="Filters" description="Keep items matching any include rule, then drop items matching any exclude rule." />
      <ul className="space-y-2">
        {list.map((filter, index) => {
          const error = rowError(issues, `config.filters.${index}.`);
          return (
            <li key={index} className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
              <div className="flex flex-wrap items-center gap-2">
                <Select aria-label="Mode" className="w-28" value={filter.mode} onChange={(e) => set(index, 'mode', e.target.value)}>
                  <option value="include">Include</option>
                  <option value="exclude">Exclude</option>
                </Select>
                <span className="text-sm text-stone-500">when</span>
                <Select aria-label="Filter field" className="w-32" value={filter.field ?? 'any'} onChange={(e) => set(index, 'field', e.target.value)}>
                  {FILTERABLE_FIELDS.map((f) => <option key={f} value={f}>{f === 'any' ? 'any field' : f}</option>)}
                </Select>
                <span className="text-sm text-stone-500">matches</span>
                <Input aria-label="Filter pattern" className="min-w-40 flex-1 font-mono text-xs" placeholder="regex, e.g. sponsored|advert" value={filter.pattern} onChange={(e) => set(index, 'pattern', e.target.value)} />
                <Input aria-label="Filter flags" className="w-16 font-mono text-xs" value={filter.flags ?? 'i'} onChange={(e) => set(index, 'flags', e.target.value)} />
                <Button size="sm" variant="ghost" aria-label="Remove filter" onClick={() => onChange({ ...config, filters: list.filter((_, i) => i !== index) })}>✕</Button>
              </div>
              {error ? <p role="alert" className="mt-1 text-xs text-red-600">{error}</p> : null}
            </li>
          );
        })}
      </ul>
      <Button size="sm" className="mt-3" onClick={() => onChange({ ...config, filters: [...list, { mode: 'exclude', field: 'any', pattern: '', flags: 'i' }] })}>
        + Add filter
      </Button>
    </Card>
  );
}
