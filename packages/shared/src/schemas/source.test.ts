import { describe, expect, it } from 'vitest';
import { checkRegex } from './regex.js';
import { sourceConfigSchema, sourceCreateSchema, sourceUpdateSchema } from './source.js';

describe('sourceConfigSchema', () => {
  it('fills defaults for a minimal xml config', () => {
    // Arrange
    const input = { parser: { type: 'xml' } };

    // Act
    const config = sourceConfigSchema.parse(input);

    // Assert
    expect(config.fetch).toEqual({ method: 'GET', headers: {}, timeoutMs: 15_000, render: false });
    expect(config.parser).toEqual({ type: 'xml', fields: {} });
    expect(config.fullText).toEqual({ mode: 'off' });
    expect(config.transforms).toEqual([]);
    expect(config.filters).toEqual([]);
    expect(config.dedupeBy).toBe('guid');
  });

  it('accepts an html config with field rules', () => {
    const config = sourceConfigSchema.parse({
      parser: {
        type: 'html',
        itemSelector: 'article',
        fields: { title: { path: 'h2' }, link: { path: 'a', attr: 'href' } },
      },
    });

    expect(config.parser).toMatchObject({ type: 'html', selectorType: 'css', itemSelector: 'article' });
  });

  it('rejects an html config without item selector', () => {
    const result = sourceConfigSchema.safeParse({ parser: { type: 'html', itemSelector: '' } });

    expect(result.success).toBe(false);
  });

  it('rejects an unknown parser type', () => {
    const result = sourceConfigSchema.safeParse({ parser: { type: 'csv' } });

    expect(result.success).toBe(false);
  });

  it('rejects a catastrophic regex in filters', () => {
    const result = sourceConfigSchema.safeParse({
      parser: { type: 'xml' },
      filters: [{ mode: 'exclude', pattern: '(a+)+$' }],
    });

    expect(result.success).toBe(false);
  });

  it('requires a selector when full-text mode is "selector"', () => {
    const result = sourceConfigSchema.safeParse({
      parser: { type: 'xml' },
      fullText: { mode: 'selector' },
    });

    expect(result.success).toBe(false);
  });

  it('rejects invalid header names', () => {
    const result = sourceConfigSchema.safeParse({
      parser: { type: 'xml' },
      fetch: { headers: { 'Bad Header': 'x' } },
    });

    expect(result.success).toBe(false);
  });
});

describe('sourceCreateSchema', () => {
  it('applies defaults and rejects non-http urls', () => {
    const ok = sourceCreateSchema.parse({
      name: ' Blog ',
      url: 'https://example.com/feed',
      config: { parser: { type: 'xml' } },
    });
    const bad = sourceCreateSchema.safeParse({
      name: 'x',
      url: 'file:///etc/passwd',
      config: { parser: { type: 'xml' } },
    });

    expect(ok).toMatchObject({ name: 'Blog', categoryId: null, refreshIntervalMinutes: 60, enabled: true });
    expect(bad.success).toBe(false);
  });

  it('does not inject defaults into partial updates', () => {
    const update = sourceUpdateSchema.parse({ name: 'Renamed' });

    expect(update).toEqual({ name: 'Renamed' });
  });
});

describe('checkRegex', () => {
  it('returns null for a valid safe pattern', () => {
    expect(checkRegex('^breaking', 'i')).toBeNull();
  });

  it('reports syntax errors', () => {
    expect(checkRegex('(unclosed')).toMatch(/Invalid regular expression/);
  });

  it('reports unsafe patterns', () => {
    expect(checkRegex('(x+x+)+y')).toMatch(/too complex/);
  });
});
