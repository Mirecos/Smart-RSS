import { ITEM_FIELDS, type FieldMap, type FieldRule, type HtmlParserConfig } from '@smart-rss/shared';
import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { JSDOM } from 'jsdom';
import { collapseWhitespace, resolveUrl } from '../../lib/html.js';
import { errorMessage, ok, pipelineErr, type Result } from '../../lib/result.js';
import { MAX_ITEMS_PER_FETCH, truncateSample, type MappedItem, type ParseOutput } from '../types.js';
import { CSS_DEFAULTS, XPATH_DEFAULTS } from './defaults.js';

type ValueReader = (rule: FieldRule) => string[];

function buildItem(fields: FieldMap, defaults: typeof CSS_DEFAULTS, read: ValueReader): MappedItem {
  const entries = ITEM_FIELDS.flatMap((field) => {
    const rule = fields[field] ?? defaults[field];
    if (!rule) return [];
    const values = read(rule).map((v) => v.trim()).filter(Boolean);
    if (values.length === 0) return [];
    return [[field, field === 'categories' ? values : values[0]]] as const;
  });
  return Object.fromEntries(entries) as MappedItem;
}

// ---- CSS (cheerio) ----

function readCss($: cheerio.CheerioAPI, node: AnyNode, rule: FieldRule): string[] {
  const self = $(node);
  const found = rule.path === '.' ? self : self.find(rule.path);
  const targets = found.length === 0 && self.is(rule.path) ? self : found;
  const attr = rule.attr ?? 'text';
  return targets.toArray().map((el) => {
    const target = $(el);
    if (attr === 'text') return collapseWhitespace(target.text());
    if (attr === 'html') return target.html() ?? '';
    return target.attr(attr) ?? '';
  });
}

function parseWithCss(body: string, parser: HtmlParserConfig): Result<ParseOutput> {
  const $ = cheerio.load(body);
  try {
    const nodes = $(parser.itemSelector).toArray();
    if (nodes.length === 0) return pipelineErr('parse', `Item selector "${parser.itemSelector}" matched no elements`);
    const items = nodes
      .slice(0, MAX_ITEMS_PER_FETCH)
      .map((node) => buildItem(parser.fields, CSS_DEFAULTS, (rule) => readCss($, node, rule)));
    return ok({ items, total: nodes.length, sample: truncateSample($.html(nodes[0]) ?? '') });
  } catch (error) {
    return pipelineErr('parse', `Invalid CSS selector: ${errorMessage(error)}`, error);
  }
}

// ---- XPath (jsdom) ----

type Win = JSDOM['window'];

function nodeValue(win: Win, node: Node, attr: string): string {
  if (node.nodeType === win.Node.ATTRIBUTE_NODE || node.nodeType === win.Node.TEXT_NODE) {
    return node.nodeValue ?? '';
  }
  if (node.nodeType !== win.Node.ELEMENT_NODE) return node.textContent ?? '';
  const element = node as Element;
  if (attr === 'text') return collapseWhitespace(element.textContent ?? '');
  if (attr === 'html') return element.innerHTML;
  return element.getAttribute(attr) ?? '';
}

function readXpath(win: Win, context: Node, rule: FieldRule): string[] {
  const result = win.document.evaluate(rule.path, context, null, win.XPathResult.ANY_TYPE, null);
  switch (result.resultType) {
    case win.XPathResult.STRING_TYPE:
      return [result.stringValue];
    case win.XPathResult.NUMBER_TYPE:
      return [String(result.numberValue)];
    case win.XPathResult.BOOLEAN_TYPE:
      return [String(result.booleanValue)];
    default: {
      const values: string[] = [];
      for (let node = result.iterateNext(); node; node = result.iterateNext()) {
        values.push(nodeValue(win, node, rule.attr ?? 'text'));
      }
      return values;
    }
  }
}

function parseWithXpath(body: string, parser: HtmlParserConfig, baseUrl: string): Result<ParseOutput> {
  const dom = new JSDOM(body, { url: baseUrl });
  const win = dom.window;
  try {
    const snapshot = win.document.evaluate(
      parser.itemSelector, win.document, null, win.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null,
    );
    const nodes = Array.from({ length: snapshot.snapshotLength }, (_, i) => snapshot.snapshotItem(i)).filter(
      (node): node is Node => node !== null,
    );
    if (nodes.length === 0) return pipelineErr('parse', `Item XPath "${parser.itemSelector}" matched no nodes`);
    const items = nodes
      .slice(0, MAX_ITEMS_PER_FETCH)
      .map((node) => buildItem(parser.fields, XPATH_DEFAULTS, (rule) => readXpath(win, node, rule)));
    const first = nodes[0] as Element;
    return ok({ items, total: nodes.length, sample: truncateSample(first.outerHTML ?? first.textContent ?? '') });
  } catch (error) {
    return pipelineErr('parse', `Invalid XPath expression: ${errorMessage(error)}`, error);
  } finally {
    win.close();
  }
}

export function parseHtml(body: string, parser: HtmlParserConfig, baseUrl: string): Result<ParseOutput> {
  return parser.selectorType === 'xpath' ? parseWithXpath(body, parser, baseUrl) : parseWithCss(body, parser);
}

/** Finds feeds advertised by an HTML page via <link rel="alternate">. */
export function discoverFeeds(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const selector = [
    'link[rel~="alternate"][type*="rss"]',
    'link[rel~="alternate"][type*="atom"]',
    'link[rel~="alternate"][type*="feed+json"]',
  ].join(', ');
  const urls = $(selector)
    .toArray()
    .map((el) => resolveUrl($(el).attr('href'), baseUrl))
    .filter((url): url is string => url !== null);
  return [...new Set(urls)];
}
