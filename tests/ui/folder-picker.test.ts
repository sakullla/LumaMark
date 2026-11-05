import { describe, expect, it } from 'vitest';
import { highlightMatch, pickerAncestors, pickerParents, pickerRowHtml, pickerRows, type PickerOption } from '../../apps/extension/src/ui/folder-picker';

const opt = (value: string, label: string, depth: number, toolbar = false): PickerOption => ({ value, label, depth, toolbar });
// Bar ▸ vps, Bar ▸ Dev ▸ Docs, Menu ▸ Firefox, plus an “Unfiled” choice with no id.
const options = [
  opt('', 'Unfiled', 0),
  opt('bar', 'Bar', 0, true),
  opt('vps', 'vps', 1),
  opt('dev', 'Dev', 1),
  opt('docs', 'Docs', 2),
  opt('menu', 'Menu', 0),
  opt('ff', 'Firefox', 1),
];
const values = (rows: { value: string }[]) => rows.map((row) => row.value);

describe('folder picker tree', () => {
  it('reads parents from depth order', () => {
    const parents = pickerParents(options);
    expect(parents.get('docs')).toBe('dev');
    expect(parents.get('ff')).toBe('menu');
    expect(parents.get('bar')).toBeUndefined();
    expect(parents.get('')).toBeUndefined();
    expect(pickerAncestors(options, 'docs')).toEqual(['bar', 'dev']);
  });

  it('hides what sits under a closed folder', () => {
    const closed = pickerRows(options, { expanded: new Set() });
    expect(values(closed)).toEqual(['', 'bar', 'menu']);
    expect(closed.find((row) => row.value === 'bar')).toMatchObject({ hasChildren: true, expanded: false });
    expect(values(pickerRows(options, { expanded: new Set(['bar']) }))).toEqual(['', 'bar', 'vps', 'dev', 'menu']);
    expect(values(pickerRows(options, { expanded: new Set(['bar', 'dev']) }))).toEqual(['', 'bar', 'vps', 'dev', 'docs', 'menu']);
    // An open child under a closed parent stays hidden.
    expect(values(pickerRows(options, { expanded: new Set(['dev']) }))).toEqual(['', 'bar', 'menu']);
  });

  it('keeps the folders that hold a search hit, whatever is closed', () => {
    const rows = pickerRows(options, { query: 'doc', expanded: new Set() });
    expect(values(rows)).toEqual(['bar', 'dev', 'docs']);
    expect(rows.map((row) => row.match)).toEqual([false, false, true]);
    expect(pickerRows(options, { query: 'nothing', expanded: new Set() })).toEqual([]);
  });

  it('highlights matches without trusting the label', () => {
    expect(highlightMatch('<Dev> dev', 'dev')).toBe('&lt;<mark>Dev</mark>&gt; <mark>dev</mark>');
    expect(highlightMatch('Docs', '')).toBe('Docs');
  });

  it('renders rows as tree items with level, state and a toggle only when browsing', () => {
    const [, bar] = pickerRows(options, { expanded: new Set(['bar']) });
    const html = pickerRowHtml(bar, { id: 'x-0', active: true, current: true, query: '', copy: { expandFolder: 'Expand', collapseFolder: 'Collapse' } });
    expect(html).toContain('role="treeitem"');
    expect(html).toContain('aria-level="1"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-toggle="bar"');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('class="pick-row tree-row is-current"');
    const searching = pickerRowHtml(bar, { id: 'x-0', active: false, current: false, query: 'b', copy: {} });
    expect(searching).not.toContain('data-toggle');
  });
});
