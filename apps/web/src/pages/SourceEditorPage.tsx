import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FetchSection } from '../components/editor/FetchSection';
import { GeneralSection } from '../components/editor/GeneralSection';
import { EnrichmentSection, ParserSection } from '../components/editor/ParserSection';
import { PreviewPanel } from '../components/editor/PreviewPanel';
import { FilterList, TransformList } from '../components/editor/RuleLists';
import { Button, ErrorBanner, Spinner } from '../components/ui';
import { useCategories, useDeleteSource, useHealth, useSaveSource, useSettings, useSource } from '../hooks/queries';
import { ApiError } from '../lib/api';
import { draftFromSource, emptyDraft, previewable, validateDraft, type Issues, type SourceDraft } from '../lib/draft';

/** Maps server-side validation details ({path, message}[]) onto the form. */
function serverIssues(error: unknown): Issues {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  return Object.fromEntries(
    (error.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message]),
  );
}

export function SourceEditorPage() {
  const params = useParams();
  const sourceId = params.id ? Number(params.id) : null;
  const navigate = useNavigate();
  const sourceQuery = useSource(sourceId);
  const { data: settings } = useSettings();
  const { data: categories = [] } = useCategories();
  const { data: health } = useHealth();
  const save = useSaveSource();
  const remove = useDeleteSource();
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (draft) return;
    if (sourceId === null) setDraft(emptyDraft(settings?.defaultRefreshMinutes ?? 60));
    else if (sourceQuery.data) setDraft(draftFromSource(sourceQuery.data));
  }, [draft, sourceId, sourceQuery.data, settings]);

  const validation = useMemo(() => (draft ? validateDraft(draft) : null), [draft]);
  const target = useMemo(() => (draft ? previewable(draft) : null), [draft]);

  if (sourceQuery.error) return <div className="p-6"><ErrorBanner error={sourceQuery.error} /></div>;
  if (!draft || !validation) return <div className="flex justify-center p-10"><Spinner /></div>;

  const issues: Issues = {
    ...(submitted && !validation.ok ? validation.issues : {}),
    ...serverIssues(save.error),
  };
  const setConfig = (config: SourceDraft['config']) => setDraft({ ...draft, config });

  const onSave = () => {
    setSubmitted(true);
    if (!validation.ok) return;
    save.mutate(
      { id: sourceId, input: validation.value },
      { onSuccess: (source) => navigate(`/source/${source.id}`) },
    );
  };

  const onDelete = () => {
    if (sourceId === null || !window.confirm(`Delete "${draft.name}" and all its items?`)) return;
    remove.mutate(sourceId, { onSuccess: () => navigate('/sources') });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1600px] gap-6 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,560px)]">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">{sourceId === null ? 'Add source' : `Edit ${sourceQuery.data?.name ?? 'source'}`}</h1>
            <div className="ml-auto flex gap-2">
              <Link to={sourceId === null ? '/sources' : `/source/${sourceId}`} className="rounded-lg px-3.5 py-2 text-sm font-medium hover:bg-stone-200/60 dark:hover:bg-stone-800">Cancel</Link>
              {sourceId !== null ? <Button variant="danger" onClick={onDelete} disabled={remove.isPending}>Delete</Button> : null}
              <Button variant="primary" onClick={onSave} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save source'}</Button>
            </div>
          </div>
          <ErrorBanner error={save.error ?? remove.error} />
          {submitted && !validation.ok ? (
            <ErrorBanner error={`Please fix ${Object.keys(validation.issues).length} problem(s): ${Object.entries(validation.issues).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join('; ')}`} />
          ) : null}
          <GeneralSection
            draft={draft}
            onChange={setDraft}
            categories={categories}
            issues={issues}
            showPresets={sourceId === null}
            onPreset={(preset) => setDraft({ ...draft, config: structuredClone(preset.config) })}
          />
          <ParserSection config={draft.config} onChange={setConfig} issues={issues} />
          <FetchSection config={draft.config} onChange={setConfig} issues={issues} rendererAvailable={Boolean(health?.renderer.reachable)} />
          <TransformList config={draft.config} onChange={setConfig} issues={issues} />
          <FilterList config={draft.config} onChange={setConfig} issues={issues} />
          <EnrichmentSection config={draft.config} onChange={setConfig} issues={issues} />
        </div>
        <div className="xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)]">
          <PreviewPanel target={target} fetchOptions={draft.config.fetch} />
        </div>
      </div>
    </div>
  );
}
