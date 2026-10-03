import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avatar, initials } from './avatar';
import { BoardCard, BoardColumn } from './board';
import { Button } from './button';
import { DataGrid, type DataGridColumn } from './data-grid';
import { DateInput } from './date-input';
import { EmptyState } from './empty-state';
import { Field } from './field';
import { Input, Select } from './input';
import { isPaletteShortcut } from './palette-shortcut';
import { StatusBadge } from './status-badge';

describe('Button', () => {
  it('keeps its label while pending, so its width and its name do not change, and says it is busy', () => {
    const html = renderToStaticMarkup(<Button pending>Save</Button>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-disabled="true"');
    // Transparent rather than `invisible`, which would take the name away from screen readers.
    expect(html).toMatch(/<span class="[^"]*opacity-0[^"]*">Save<\/span>/);
    expect(html).not.toContain('invisible');
    expect(html).not.toContain('disabled=""');
  });

  it('is a plain button by default and square as an icon button', () => {
    expect(renderToStaticMarkup(<Button>Go</Button>)).toContain('type="button"');
    expect(renderToStaticMarkup(<Button size="icon">Go</Button>)).toContain('size-control');
  });
});

describe('Field', () => {
  it('ties its label, helper and error to the control inside it', () => {
    const html = renderToStaticMarkup(
      <Field id="phone" label="Mobile number" helper="Ten digits" error="Please check it">
        <Input name="phone" />
      </Field>,
    );
    expect(html).toContain('for="phone"');
    expect(html).toContain('id="phone"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="phone-error phone-helper"');
    expect(html).toContain('id="phone-error"');
  });

  it('leaves a control without an error unmarked', () => {
    const html = renderToStaticMarkup(
      <Field id="name" label="Name">
        <Select name="name">
          <option value="a">A</option>
        </Select>
      </Field>,
    );
    expect(html).not.toContain('aria-invalid="');
    expect(html).not.toContain('aria-describedby="');
  });
});

describe('DateInput', () => {
  it('shows DD-MM-YYYY and sends the ISO date under its name', () => {
    const html = renderToStaticMarkup(<DateInput name="from" defaultValue="2026-09-27" />);
    expect(html).toContain('value="27-09-2026"');
    expect(html).toContain('type="hidden" name="from" value="2026-09-27"');
  });
});

describe('StatusBadge', () => {
  it('uses the soft tint with the base status colour', () => {
    const html = renderToStaticMarkup(<StatusBadge tone="danger">Suspended</StatusBadge>);
    expect(html).toContain('bg-danger-soft');
    expect(html).toContain('text-danger');
  });
});

interface Row {
  id: string;
  name: string;
  amount: string;
}
const columns: DataGridColumn<Row>[] = [
  { id: 'name', header: 'Name', cell: (r) => r.name, primary: true },
  { id: 'amount', header: 'Price', cell: (r) => r.amount, align: 'end', numeric: true },
];

describe('DataGrid', () => {
  it('shows the empty state when there is nothing to list', () => {
    const html = renderToStaticMarkup(
      <DataGrid
        caption="Prices"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<EmptyState message="No prices yet." />}
      />,
    );
    expect(html).toContain('No prices yet.');
    expect(html).not.toContain('<table');
  });

  it('shows skeleton rows, not a spinner, while the first page loads', () => {
    const html = renderToStaticMarkup(
      <DataGrid
        caption="Prices"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        loading
        skeletonRows={3}
        empty={null}
      />,
    );
    expect(html.match(/animate-pulse/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('aria-busy="true"');
  });

  it('right-aligns amounts with tabular numerals and offers Load more while pages remain', () => {
    const html = renderToStaticMarkup(
      <DataGrid
        caption="Prices"
        columns={columns}
        rows={[{ id: '1', name: 'Pump', amount: '1,24,750.00' }]}
        rowKey={(r) => r.id}
        empty={null}
        loadMore={{ label: 'Load more', onLoadMore: () => undefined, pending: false }}
      />,
    );
    expect(html).toMatch(/<td class="[^"]*text-right[^"]*tabular-nums[^"]*">1,24,750.00<\/td>/);
    expect(html).toContain('sticky top-0');
    expect(html).toContain('Load more');
    // the phone card list carries the same rows
    expect(html).toContain('md:hidden');
  });
});

describe('isPaletteShortcut', () => {
  it('answers ⌘K and Ctrl+K only', () => {
    expect(isPaletteShortcut({ key: 'k', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: 'K', metaKey: false, ctrlKey: true })).toBe(true);
    expect(isPaletteShortcut({ key: 'k', metaKey: false, ctrlKey: false })).toBe(false);
    expect(isPaletteShortcut({ key: 'j', metaKey: true, ctrlKey: false })).toBe(false);
  });
});

describe('BoardColumn and BoardCard', () => {
  it('draw the stage colour on the top bar, the heading, count and cards', () => {
    const html = renderToStaticMarkup(
      <BoardColumn title="Contacted" tone="contacted" count="1 lead" emptyLabel="None here">
        <BoardCard
          title="Customer"
          subtitle="Village"
          age="Open for 2 days"
          owner="With Priya"
          sla={{ tone: 'warn', label: 'Due soon' }}
          dragId="lead-1"
        />
      </BoardColumn>,
    );
    expect(html).toContain('bg-stage-contacted');
    expect(html).toMatch(/<h2 id="[^"]+" tabindex="-1" class="[^"]*">Contacted<\/h2>/);
    expect(html).toContain('1 lead');
    expect(html).toContain('draggable="true"');
    expect(html).toContain('role="img" aria-label="Due soon"');
    expect(html).toContain('bg-sla-warn');
    expect(html).not.toContain('None here');
  });

  it('say so when a stage is empty, and leave a card without a drag id in place', () => {
    const empty = renderToStaticMarkup(
      <BoardColumn
        title="New"
        tone="new"
        count="0 leads"
        emptyLabel="None here"
        headingLevel="h4"
      />,
    );
    expect(empty).toContain('None here');
    expect(empty).toContain('<h4');
    expect(empty).not.toContain('<ul');
    const card = renderToStaticMarkup(
      <BoardCard title="Customer" subtitle="Village" age="Opened today" owner="Nobody yet" />,
    );
    expect(card).toContain('draggable="false"');
    expect(card).not.toContain('role="img"');
  });

  it('show the owner’s initials in a circle named with their full name', () => {
    const card = renderToStaticMarkup(
      <BoardCard
        title="Customer"
        subtitle="Village"
        age="Opened today"
        owner="With Priya Deshmukh"
        ownerName="Priya Deshmukh"
      />,
    );
    expect(card).toContain('role="img" aria-label="Priya Deshmukh"');
    expect(card).toContain('<span aria-hidden="true">PD</span>');
    expect(card).toContain('rounded-full');
  });
});

describe('initials', () => {
  it('takes the first letter of a one-word name', () => {
    expect(initials('Priya')).toBe('P');
    expect(initials('suresh')).toBe('S');
  });

  it('takes the first letters of the first and last words', () => {
    expect(initials('Priya Deshmukh')).toBe('PD');
    expect(initials('Ramesh Kumar Patil')).toBe('RP');
  });

  it('ignores extra spaces', () => {
    expect(initials('  Asha   Rani  ')).toBe('AR');
    expect(initials('\tAsha\n')).toBe('A');
  });

  it('treats dots as word breaks, as in initialled names', () => {
    expect(initials('R. K. Sharma')).toBe('RS');
    expect(initials('R.K.Sharma')).toBe('RS');
    expect(initials('Sharma R.')).toBe('SR');
  });

  it('draws nothing for a name with no letters', () => {
    expect(initials('')).toBe('');
    expect(initials(' . ')).toBe('');
    expect(renderToStaticMarkup(<Avatar name="  " />)).toBe('');
  });
});
