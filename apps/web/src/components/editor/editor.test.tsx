import type { ItemDto, SourceConfigInput } from '@smart-rss/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ItemList, snippet } from '../reader/ItemList';
import { ItemView, safeHtml } from '../reader/ItemView';
import { headersToText, textToHeaders } from './FetchSection';
import { ParserSection } from './ParserSection';
import { FilterList, newTransform, TransformList } from './RuleLists';

function Harness({ initial, onConfig, children }: {
  initial: SourceConfigInput;
  onConfig: (c: SourceConfigInput) => void;
  children: (config: SourceConfigInput, set: (c: SourceConfigInput) => void) => React.ReactNode;
}) {
  const [config, setConfig] = useState(initial);
  const set = (next: SourceConfigInput) => {
    setConfig(next);
    onConfig(next);
  };
  return <>{children(config, set)}</>;
}

describe('ParserSection', () => {
  it('switches to HTML and edits selectors and field rules', () => {
    const onConfig = vi.fn();
    render(
      <Harness initial={{ parser: { type: 'xml', fields: {} } }} onConfig={onConfig}>
        {(config, set) => <ParserSection config={config} onChange={set} issues={{}} />}
      </Harness>,
    );

    fireEvent.click(screen.getByRole('radio', { name: /HTML page/ }));
    fireEvent.change(screen.getByLabelText('Item selector'), { target: { value: 'li.post' } });
    fireEvent.change(screen.getByLabelText('Title path'), { target: { value: 'h3' } });
    fireEvent.change(screen.getByLabelText('Link path'), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText('Link attribute'), { target: { value: 'href' } });

    expect(onConfig).toHaveBeenLastCalledWith({
      parser: {
        type: 'html',
        selectorType: 'css',
        itemSelector: 'li.post',
        fields: { title: { path: 'h3' }, link: { path: 'a', attr: 'href' } },
      },
    });
  });

  it('shows JSON items path and date format inputs', () => {
    const onConfig = vi.fn();
    render(
      <Harness initial={{ parser: { type: 'json', fields: { publishedAt: { path: 'date' } } } }} onConfig={onConfig}>
        {(config, set) => <ParserSection config={config} onChange={set} issues={{ 'config.parser.itemsPath': 'Bad path' }} />}
      </Harness>,
    );

    fireEvent.change(screen.getByLabelText('Items path (JSONPath)'), { target: { value: '$.data[*]' } });
    fireEvent.change(screen.getByLabelText('Date format'), { target: { value: 'dd/MM/yyyy' } });

    expect(screen.getByText('Bad path')).toBeInTheDocument();
    expect(onConfig).toHaveBeenLastCalledWith({
      parser: { type: 'json', itemsPath: '$.data[*]', fields: { publishedAt: { path: 'date', dateFormat: 'dd/MM/yyyy' } } },
    });
  });
});

describe('rule lists', () => {
  it('adds, edits and removes transforms and filters', () => {
    const onConfig = vi.fn();
    render(
      <Harness initial={{ parser: { type: 'xml' } }} onConfig={onConfig}>
        {(config, set) => (
          <>
            <TransformList config={config} onChange={set} issues={{ 'config.transforms.0.pattern': 'Too complex' }} />
            <FilterList config={config} onChange={set} issues={{}} />
          </>
        )}
      </Harness>,
    );

    fireEvent.click(screen.getByText('+ Add transform'));
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: '^AD ' } });
    fireEvent.change(screen.getByLabelText('Operation'), { target: { value: 'truncate' } });
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '50' } });
    fireEvent.click(screen.getByText('+ Add filter'));
    fireEvent.change(screen.getByLabelText('Filter pattern'), { target: { value: 'sponsored' } });
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'include' } });

    expect(screen.getByText('Too complex')).toBeInTheDocument();
    expect(onConfig).toHaveBeenLastCalledWith({
      parser: { type: 'xml' },
      transforms: [{ op: 'truncate', field: 'title', length: 50 }],
      filters: [{ mode: 'include', field: 'any', pattern: 'sponsored', flags: 'i' }],
    });

    fireEvent.click(screen.getByLabelText('Remove transform'));
    fireEvent.click(screen.getByLabelText('Remove filter'));
    expect(onConfig).toHaveBeenLastCalledWith({ parser: { type: 'xml' }, transforms: [], filters: [] });
  });

  it('creates sensible default transforms', () => {
    expect(newTransform('defaultValue', 'author')).toEqual({ op: 'defaultValue', field: 'author', value: '' });
    expect(newTransform('stripHtml')).toEqual({ op: 'stripHtml', field: 'title' });
  });
});

describe('headers text conversion', () => {
  it('round-trips headers and ignores malformed lines', () => {
    expect(textToHeaders('Authorization: Bearer a:b\n  \nno-colon\n: empty-name\nX-Test:1')).toEqual({ Authorization: 'Bearer a:b', 'X-Test': '1' });
    expect(headersToText({ A: '1', B: '2' })).toBe('A: 1\nB: 2');
    expect(headersToText(undefined)).toBe('');
  });
});

const item: ItemDto = {
  id: 1, sourceId: 1, sourceName: 'Blog', guid: 'g', title: 'Hello', link: 'https://example.com/a',
  contentHtml: '<p>Body<script>alert(1)</script><img src="x" onerror="alert(1)"></p>', summary: null, author: 'Ann',
  imageUrl: null, categories: ['tag'], publishedAt: '2024-01-01T00:00:00Z', fetchedAt: '2024-01-01T00:00:00Z',
  isRead: false, isStarred: false,
};

describe('reader components', () => {
  it('sanitizes HTML again on the client', () => {
    const html = safeHtml(item.contentHtml ?? '');

    expect(html).not.toMatch(/script|onerror/);
    expect(snippet('<p>Hello&nbsp;<b>world</b></p>')).toBe('Hello world');
    expect(snippet('x'.repeat(200))).toHaveLength(161);
    expect(snippet(null)).toBe('');
  });

  it('renders an item and its actions', () => {
    const onToggleRead = vi.fn();
    const onToggleStar = vi.fn();
    render(<ItemView item={item} onToggleRead={onToggleRead} onToggleStar={onToggleStar} />);

    fireEvent.click(screen.getByText('☆ Star'));
    fireEvent.click(screen.getByText('Mark read'));

    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    expect(onToggleStar).toHaveBeenCalledWith(item);
    expect(onToggleRead).toHaveBeenCalledWith(item);
    expect(document.querySelector('script')).toBeNull();
  });

  it('renders the empty item view and item list states', () => {
    const { rerender } = render(<ItemView item={null} onToggleRead={vi.fn()} onToggleStar={vi.fn()} />);
    expect(screen.getByText('Select an item')).toBeInTheDocument();

    const onSelect = vi.fn();
    const onLoadMore = vi.fn();
    rerender(<ItemList items={[item]} selectedId={1} onSelect={onSelect} isLoading={false} error={null} hasMore loadingMore={false} onLoadMore={onLoadMore} />);
    fireEvent.click(screen.getByText('Hello'));
    fireEvent.click(screen.getByText('Load more'));
    expect(onSelect).toHaveBeenCalledWith(item);
    expect(onLoadMore).toHaveBeenCalled();

    rerender(<ItemList items={[]} selectedId={null} onSelect={onSelect} isLoading={false} error={null} hasMore={false} loadingMore={false} onLoadMore={onLoadMore} />);
    expect(screen.getByText('Nothing to read here')).toBeInTheDocument();
  });
});
