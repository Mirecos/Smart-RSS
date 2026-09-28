import { describe, expect, it } from 'vitest';
import { BASE_PATH, readBasePath, withBase } from './base';

function documentWith(content: string | null): Document {
  const doc = document.implementation.createHTMLDocument('test');
  if (content !== null) {
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'smart-rss-base');
    meta.setAttribute('content', content);
    doc.head.appendChild(meta);
  }
  return doc;
}

describe('base path', () => {
  it('reads the prefix injected by the server', () => {
    expect(readBasePath(documentWith('/smart-rss'))).toBe('/smart-rss');
    expect(readBasePath(documentWith('/smart-rss/'))).toBe('/smart-rss');
    expect(readBasePath(documentWith(''))).toBe('');
    expect(readBasePath(documentWith(null))).toBe('');
  });

  it('prefixes app paths (no prefix in tests)', () => {
    expect(BASE_PATH).toBe('');
    expect(withBase('/api/opml')).toBe('/api/opml');
  });
});
