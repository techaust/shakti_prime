import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardCard, BoardColumn } from './board';
import { EmptyState } from './empty-state';
import { Input, Select, Textarea } from './input';
import { Skeleton } from './skeleton';
import { TOAST_DURATION_MS } from './toast';
import { ToastRegion } from './toast-region';

describe('Input, Select and Textarea', () => {
  it('share the control look: 36 px, the strong border, 44 px on phones (DESIGN.md §6)', () => {
    for (const html of [
      renderToStaticMarkup(<Input name="village" />),
      renderToStaticMarkup(
        <Select name="stage">
          <option value="new">New</option>
        </Select>,
      ),
    ]) {
      expect(html).toContain('h-control');
      expect(html).toContain('border-border-strong');
      expect(html).toContain('max-md:h-control-phone');
      expect(html).toContain('rounded-md');
    }
    expect(renderToStaticMarkup(<Textarea name="note" />)).toContain('min-h-20');
  });

  it('mark a wrong value for screen readers and in the danger colour', () => {
    const html = renderToStaticMarkup(<Input name="phone" invalid />);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-invalid:border-danger');
    expect(renderToStaticMarkup(<Input name="phone" invalid={false} />)).not.toContain(
      'aria-invalid="',
    );
    expect(renderToStaticMarkup(<Textarea name="note" invalid />)).toContain('aria-invalid="true"');
  });

  it('keep their own id and description outside a field', () => {
    const html = renderToStaticMarkup(<Input id="pin" aria-describedby="pin-help" name="pin" />);
    expect(html).toContain('id="pin"');
    expect(html).toContain('aria-describedby="pin-help"');
  });

  it('give the select a chevron screen readers skip, over the native picker', () => {
    const html = renderToStaticMarkup(
      <Select name="stage" disabled>
        <option value="new">New</option>
      </Select>,
    );
    expect(html).toContain('appearance-none');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('disabled=""');
  });
});

describe('Toaster', () => {
  // The region `Toaster` fetches once the page is idle (toast.tsx).
  const html = renderToStaticMarkup(<ToastRegion label="Notifications" />);

  it('is a region screen readers announce politely, named from the catalogue', () => {
    expect(html).toMatch(/<section[^>]*aria-label="Notifications[^"]*"/);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-relevant="additions text"');
  });

  it('keeps a toast four seconds (DESIGN.md §6)', () => {
    expect(TOAST_DURATION_MS).toBe(4000);
  });
});

describe('EmptyState', () => {
  it('says one sentence and offers at most one action', () => {
    const html = renderToStaticMarkup(
      <EmptyState message="No leads yet." action={<a href="/leads/new">Add a lead</a>} />,
    );
    expect(html).toContain('<p class="text-text-muted max-w-sm">No leads yet.</p>');
    expect(html).toContain('<a href="/leads/new">Add a lead</a>');
    expect(html).toContain('border-dashed');
  });

  it('hides its icon from screen readers, and draws none when given none', () => {
    const withIcon = renderToStaticMarkup(<EmptyState message="Nothing here." icon={<svg />} />);
    expect(withIcon).toMatch(/<span aria-hidden="true"[^>]*><svg><\/svg><\/span>/);
    expect(renderToStaticMarkup(<EmptyState message="Nothing here." />)).not.toContain(
      'aria-hidden',
    );
  });
});

describe('Skeleton', () => {
  it('is a grey block screen readers skip, whose pulse stops for reduced motion', () => {
    const html = renderToStaticMarkup(<Skeleton className="h-4 w-24" />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('bg-surface-3');
    expect(html).toContain('animate-pulse');
    expect(html).toContain('motion-reduce:animate-none');
    expect(html).toContain('h-4 w-24');
    expect(html).not.toContain('spin');
  });
});

describe('BoardColumn Load more', () => {
  const column = (pending: boolean) =>
    renderToStaticMarkup(
      <BoardColumn
        title="Contacted"
        tone="contacted"
        count="240 leads"
        emptyLabel="None here"
        loadMore={{
          label: 'Load more',
          accessibleLabel: 'Load more leads in Contacted',
          status: 'Showing the newest 100 of 240 leads',
          onLoadMore: () => undefined,
          pending,
        }}
      >
        <BoardCard title="Customer" subtitle="Village" age="Opened today" owner="Nobody yet" />
      </BoardColumn>,
    );

  it('shows how many cards show of how many, and a button named for the stage', () => {
    const html = column(false);
    const status =
      /<p id="([^"]+)" role="status"[^>]*>Showing the newest 100 of 240 leads<\/p>/.exec(html);
    expect(status).not.toBeNull();
    expect(html).toMatch(
      new RegExp(
        `<button type="button" aria-label="Load more leads in Contacted" aria-describedby="${status?.[1] ?? '-'}"`,
      ),
    );
    expect(html).toContain('>Load more</span>');
    expect(html).not.toContain('animate-pulse');
  });

  it('waits while the next page is on its way, with skeleton cards in its place', () => {
    const html = column(true);
    expect(html).toContain('aria-busy="true"');
    expect(
      html.match(/<li aria-hidden="true"><div aria-hidden="true" class="[^"]*animate-pulse/g),
    ).toHaveLength(2);
  });

  it('has no footer when the stage shows every card', () => {
    const html = renderToStaticMarkup(
      <BoardColumn title="New" tone="new" count="1 lead" emptyLabel="None here">
        <BoardCard title="Customer" subtitle="Village" age="Opened today" owner="Nobody yet" />
      </BoardColumn>,
    );
    expect(html).not.toContain('<footer');
    expect(html).not.toContain('role="status"');
    // The heading can take focus when the last page removes the button.
    expect(html).toMatch(/<h2 id="[^"]+" tabindex="-1"/);
  });
});
