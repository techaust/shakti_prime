import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataGrid, type DataGridColumn } from './data-grid';
import {
  canHideColumn,
  nextSort,
  selectionState,
  sortRows,
  toggleAllSelection,
  toggleColumn,
  toggleRowSelection,
  visibleColumns,
} from './data-grid-state';

interface Lead {
  id: string;
  customer: string;
  village: string | null;
  kw: number | null;
}

const columns: DataGridColumn<Lead>[] = [
  {
    id: 'customer',
    header: 'Customer',
    primary: true,
    cell: (r) => r.customer,
    sortValue: (r) => r.customer,
  },
  { id: 'village', header: 'Village', cell: (r) => r.village, sortValue: (r) => r.village },
  {
    id: 'kw',
    header: 'Size',
    align: 'end',
    numeric: true,
    cell: (r) => r.kw,
    sortValue: (r) => r.kw,
  },
  { id: 'actions', header: <span className="sr-only">Actions</span>, cell: () => null },
];

const rows: Lead[] = [
  { id: 'a', customer: 'Ramesh Patil', village: 'Pump 10', kw: 5 },
  { id: 'b', customer: 'anita Deshmukh', village: null, kw: 3 },
  { id: 'c', customer: 'Suresh Jadhav', village: 'Pump 2', kw: null },
];

describe('column chooser rules', () => {
  it('never hides the primary column or one without a name to show', () => {
    expect(canHideColumn(columns[0]!, columns)).toBe(false);
    expect(canHideColumn(columns[1]!, columns)).toBe(true);
    expect(canHideColumn(columns[3]!, columns)).toBe(false);
    expect(visibleColumns(columns, ['customer', 'village', 'actions']).map((c) => c.id)).toEqual([
      'customer',
      'kw',
      'actions',
    ]);
  });

  it('ticks and unticks a column, leaving a protected one as it is', () => {
    expect(toggleColumn(columns, [], 'village')).toEqual(['village']);
    expect(toggleColumn(columns, ['village'], 'village')).toEqual([]);
    expect(toggleColumn(columns, [], 'customer')).toEqual([]);
    expect(toggleColumn(columns, [], 'unknown')).toEqual([]);
  });

  it('keeps at least one column even when every column could be hidden', () => {
    const loose: DataGridColumn<Lead>[] = [
      { id: 'one', header: 'One', cell: () => null, hideable: false },
      { id: 'two', header: 'Two', cell: () => null },
    ];
    expect(visibleColumns(loose, ['one', 'two']).map((c) => c.id)).toEqual(['one']);
    const single: DataGridColumn<Lead>[] = [{ id: 'only', header: 'Only', cell: () => null }];
    expect(visibleColumns(single, ['only']).map((c) => c.id)).toEqual(['only']);
  });
});

describe('sorting', () => {
  it('goes up, then down, then back to the list order', () => {
    expect(nextSort(null, 'kw')).toEqual({ columnId: 'kw', direction: 'asc' });
    expect(nextSort({ columnId: 'kw', direction: 'asc' }, 'kw')).toEqual({
      columnId: 'kw',
      direction: 'desc',
    });
    expect(nextSort({ columnId: 'kw', direction: 'desc' }, 'kw')).toBeNull();
    expect(nextSort({ columnId: 'kw', direction: 'desc' }, 'village')).toEqual({
      columnId: 'village',
      direction: 'asc',
    });
  });

  it('sorts names as people read them, numbers as numbers and empty values last', () => {
    const ids = (sorted: Lead[]) => sorted.map((r) => r.id);
    expect(ids(sortRows(rows, columns, { columnId: 'customer', direction: 'asc' }))).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(ids(sortRows(rows, columns, { columnId: 'village', direction: 'asc' }))).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(ids(sortRows(rows, columns, { columnId: 'village', direction: 'desc' }))).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(ids(sortRows(rows, columns, { columnId: 'kw', direction: 'desc' }))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps the list order without a sort or for a column with nothing to sort by', () => {
    expect(sortRows(rows, columns, null)).toEqual(rows);
    expect(sortRows(rows, columns, { columnId: 'actions', direction: 'asc' })).toEqual(rows);
    expect(sortRows(rows, columns, null)).not.toBe(rows);
  });
});

describe('selection', () => {
  it('ticks one row, and select all ticks or unticks every loaded row', () => {
    const one = toggleRowSelection(new Set(), 'a');
    expect([...one]).toEqual(['a']);
    expect(selectionState(one, ['a', 'b'])).toBe('some');
    const all = toggleAllSelection(one, ['a', 'b']);
    expect([...all].sort()).toEqual(['a', 'b']);
    expect(selectionState(all, ['a', 'b'])).toBe('all');
    expect([...toggleAllSelection(all, ['a', 'b'])]).toEqual([]);
    expect([...toggleRowSelection(all, 'a')]).toEqual(['b']);
    expect(selectionState(new Set(), [])).toBe('none');
  });
});

describe('DataGrid options', () => {
  const render = (props: Partial<Parameters<typeof DataGrid<Lead>>[0]>) =>
    renderToStaticMarkup(
      <DataGrid
        caption="Leads"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={null}
        {...props}
      />,
    );

  it('marks the sorted column with aria-sort and one chevron, and makes headers buttons', () => {
    const html = render({
      sort: { columnId: 'kw', direction: 'desc' },
      onSortChange: () => undefined,
    });
    expect(html).toContain('aria-sort="descending"');
    expect(html.match(/aria-sort="none"/g)?.length).toBe(2);
    expect(html.match(/<button type="button"[^>]*>Customer/g)?.length).toBe(1);
    expect(html.match(/lucide-chevron-down/g)?.length).toBe(1);
    // the actions column is not sortable
    expect(html).not.toMatch(/<th[^>]*aria-sort[^>]*><span class="sr-only">Actions/);
  });

  it('shows plain headers and no toolbar when the caller asks for none of the options', () => {
    const html = render({});
    expect(html).not.toContain('aria-sort');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('lucide-columns3');
  });

  it('leaves out hidden columns in the table and the phone cards, and offers the chooser', () => {
    const html = render({
      columnChooser: { label: 'Columns', hidden: ['village'], onHiddenChange: () => undefined },
    });
    expect(html).not.toContain('Pump 10');
    expect(html).not.toContain('>Village<');
    expect(html).toContain('Columns');
    expect(html).toContain('aria-haspopup="menu"');
  });

  it('adds a checkbox per row, a select-all box and the count line when selectable', () => {
    const html = render({
      selectable: {
        selected: new Set(['a']),
        onSelectedChange: () => undefined,
        selectAllLabel: 'Select all loaded leads',
        selectRowLabel: (r) => `Select ${r.customer}`,
        summary: (n) => `${String(n)} selected`,
      },
    });
    expect(html).toContain('aria-label="Select Ramesh Patil"');
    expect(html).toContain('aria-label="Select all loaded leads"');
    expect(html).toContain('1 selected');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('data-selected="true"');
  });

  it('puts the caller toolbar beside the chooser', () => {
    const html = render({ toolbar: <button type="button">Views</button> });
    expect(html).toContain('>Views</button>');
  });
});
