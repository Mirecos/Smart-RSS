import type { ParserConfig } from '@smart-rss/shared';
import type { Result } from '../../lib/result.js';
import type { ParseOutput } from '../types.js';
import { discoverFeeds, parseHtml } from './html.js';
import { parseJson } from './json.js';
import { parseXml } from './xml.js';

export function parseDocument(body: string, parser: ParserConfig, baseUrl: string): Result<ParseOutput> {
  switch (parser.type) {
    case 'xml':
      return parseXml(body, parser);
    case 'json':
      return parseJson(body, parser);
    case 'html':
      return parseHtml(body, parser, baseUrl);
  }
}

const looksLikeHtml = (body: string) => /^\s*(<!doctype html|<html)/i.test(body.slice(0, 500));

/** Suggests a fix when an xml/json source actually returned an HTML page. */
export function parseHint(body: string, parser: ParserConfig, baseUrl: string): string | null {
  if (parser.type === 'html' || !looksLikeHtml(body)) return null;
  const feeds = discoverFeeds(body, baseUrl);
  return feeds.length > 0
    ? `This URL returns an HTML page that advertises these feeds: ${feeds.join(', ')}`
    : 'This URL returns an HTML page. Use the HTML source type with selectors, or find the site\'s feed URL.';
}
