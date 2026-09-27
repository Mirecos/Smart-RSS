import type { FetchOptions, FullTextConfig } from '@smart-rss/shared';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import { JSDOM } from 'jsdom';
import { errorMessage, ok, pipelineErr, type Result } from '../lib/result.js';
import { fetchDocument } from './fetch.js';
import type { FetchImpl, FetchLimits } from './types.js';

export interface FullTextDeps {
  fetchOptions: FetchOptions;
  limits: FetchLimits;
  fetchImpl?: FetchImpl;
}

function extractWithSelector(body: string, selector: string, link: string): Result<string> {
  try {
    const html = cheerio.load(body)(selector).first().html()?.trim();
    return html ? ok(html) : pipelineErr('fulltext', `Selector "${selector}" matched nothing on ${link}`);
  } catch (error) {
    return pipelineErr('fulltext', `Invalid full-text selector: ${errorMessage(error)}`, error);
  }
}

function extractWithReadability(body: string, url: string): Result<string> {
  const dom = new JSDOM(body, { url });
  try {
    const article = new Readability(dom.window.document).parse();
    return article?.content ? ok(article.content) : pipelineErr('fulltext', `No article content found on ${url}`);
  } catch (error) {
    return pipelineErr('fulltext', `Readability failed: ${errorMessage(error)}`, error);
  } finally {
    dom.window.close();
  }
}

/** Downloads an item's page and extracts the article HTML. */
export async function extractFullText(link: string, config: FullTextConfig, deps: FullTextDeps): Promise<Result<string>> {
  const page = await fetchDocument({
    url: link,
    options: { ...deps.fetchOptions, method: 'GET', body: undefined },
    limits: deps.limits,
    fetchImpl: deps.fetchImpl,
  });
  if (!page.ok) return pipelineErr('fulltext', `${link}: ${page.error.message}`, page.error);
  return config.mode === 'selector' && config.selector
    ? extractWithSelector(page.value.body, config.selector, link)
    : extractWithReadability(page.value.body, page.value.finalUrl);
}
