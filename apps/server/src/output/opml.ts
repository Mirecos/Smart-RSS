import type { CategoryDto, SourceDto } from '@smart-rss/shared';
import { generateOpml, parseOpml, type Opml } from 'feedsmith';
import { errorMessage, ok, pipelineErr, type Result } from '../lib/result.js';

export interface OpmlEntry {
  name: string;
  url: string;
  category: string | null;
}

type Outline = Opml.Outline<string>;

/**
 * Builds an OPML document. XML sources point to their original feed; JSON/HTML sources point to
 * this app's generated RSS feed so other readers can consume them.
 */
export function buildOpml(categories: CategoryDto[], sources: SourceDto[], baseUrl: string): string {
  const toOutline = (source: SourceDto): Outline => ({
    text: source.name,
    title: source.name,
    type: 'rss',
    xmlUrl: source.config.parser.type === 'xml' ? source.url : `${baseUrl}/feeds/source-${source.id}.rss`,
    htmlUrl: source.url,
  });
  const grouped = categories
    .map((category) => ({
      text: category.name,
      title: category.name,
      outlines: sources.filter((s) => s.categoryId === category.id).map(toOutline),
    }))
    .filter((group) => group.outlines.length > 0);
  const uncategorized = sources.filter((s) => s.categoryId === null).map(toOutline);
  return generateOpml({
    head: { title: 'Smart RSS subscriptions', dateCreated: new Date() },
    body: { outlines: [...grouped, ...uncategorized] },
  });
}

function collect(outlines: Outline[] | undefined, category: string | null): OpmlEntry[] {
  return (outlines ?? []).flatMap((outline) => {
    if (outline.xmlUrl) {
      return [{ name: outline.title || outline.text || outline.xmlUrl, url: outline.xmlUrl, category }];
    }
    return collect(outline.outlines, category ?? (outline.title || outline.text || null));
  });
}

/** Extracts feed subscriptions from OPML; nested outlines become categories (outermost wins). */
export function parseOpmlEntries(content: string): Result<OpmlEntry[]> {
  try {
    const document = parseOpml(content);
    return ok(collect(document.body?.outlines as Outline[] | undefined, null));
  } catch (error) {
    return pipelineErr('parse', `Invalid OPML: ${errorMessage(error)}`, error);
  }
}
