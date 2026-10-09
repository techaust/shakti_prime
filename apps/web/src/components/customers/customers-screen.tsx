'use client';

import type { CustomerPageDto, CustomerRowDto, CustomerSort } from '@shakti/contracts';
import { Button, DataGrid, EmptyState, Field, Input, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState, type SyntheticEvent } from 'react';
import { listCustomers } from '../../actions/crm';
import { CUSTOMER_SEARCH_MIN_CHARS, CUSTOMER_SORT_COLUMNS } from '../../screens/contract-values';
import { customerHref } from '../../screens/customers';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { sortInput, toListSort } from '../screens/list-sort';
import { useQuery } from '../screens/use-command';
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu } from '../screens/views-menu';

const PAGE_SIZE = 50;

/**
 * The customers grid (`/customers`): by name on the server over every customer the caller reads,
 * with a search by name, village or the last digits of a phone, Load more and saved views. A
 * phone shows only its last four digits here; Account 360 shows it in full.
 */
export function CustomersScreen({
  initial,
  companies,
  showCompany,
}: {
  initial: CustomerPageDto;
  companies: Record<number, string>;
  showCompany: boolean;
}) {
  const t = useTranslations('customers');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [truncated, setTruncated] = useState(initial.truncated);
  const [query, setQuery] = useState<string | undefined>(undefined);
  const { load, pending, failure } = useQuery<CustomerPageDto>();
  // The order and search the rows on screen were read with; an older answer is dropped.
  const readWith = useRef<{ sort: CustomerSort | undefined; q: string | undefined }>({
    sort: undefined,
    q: undefined,
  });

  function readFirst(next: { sort: CustomerSort | undefined; q: string | undefined }) {
    readWith.current = next;
    setRows([]);
    setNextCursor(null);
    load(
      () =>
        listCustomers({
          limit: PAGE_SIZE,
          ...sortInput(next.sort),
          ...(next.q === undefined ? {} : { q: next.q }),
        }),
      (page) => {
        if (readWith.current !== next) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
        setTruncated(page.truncated);
      },
    );
  }

  const view = useGridView({
    density: 'compact',
    onSortChange: (next) => {
      readFirst({ sort: toListSort(next, CUSTOMER_SORT_COLUMNS), q: readWith.current.q });
    },
  });

  function loadMore() {
    if (nextCursor === null) return;
    const now = readWith.current;
    load(
      () =>
        listCustomers({
          limit: PAGE_SIZE,
          cursor: nextCursor,
          ...sortInput(now.sort),
          ...(now.q === undefined ? {} : { q: now.q }),
        }),
      (page) => {
        if (readWith.current !== now) return;
        setRows((all) => [...all, ...page.items]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  function search(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = formText(new FormData(e.currentTarget), 'q').trim();
    const q = text.length >= CUSTOMER_SEARCH_MIN_CHARS ? text : undefined;
    setQuery(q);
    readFirst({ sort: readWith.current.sort, q });
  }

  const notRecorded = <span className="text-text-muted">{t('notRecorded')}</span>;
  const columns: DataGridColumn<CustomerRowDto>[] = [
    {
      id: 'name',
      header: t('columns.customer'),
      primary: true,
      sortable: true,
      cell: (r) => (
        <Link
          href={customerHref(r.accountId, r.entityId)}
          className="text-accent-text hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    {
      id: 'contact',
      header: t('columns.contact'),
      cell: (r) => r.contactName ?? notRecorded,
    },
    {
      id: 'phone',
      header: t('columns.phone'),
      numeric: true,
      cell: (r) =>
        r.phoneLast4 === null ? notRecorded : t('phoneEnding', { digits: r.phoneLast4 }),
    },
    {
      id: 'village',
      header: t('columns.village'),
      cell: (r) => r.village ?? notRecorded,
    },
    {
      id: 'owner',
      header: t('columns.owner'),
      cell: (r) => r.ownerName ?? notRecorded,
    },
    {
      id: 'openLeads',
      header: t('columns.openLeads'),
      numeric: true,
      cell: (r) => r.openLeads,
    },
  ];
  if (showCompany) {
    columns.push({
      id: 'company',
      header: t('columns.company'),
      cell: (r) => companies[r.entityId] ?? '',
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form
        onSubmit={search}
        className="flex"
        role="search"
        aria-label={t('searchLabel')}
        noValidate
      >
        <Field
          id="customers-search"
          label={t('searchLabel')}
          helper={t('searchHelper')}
          className="min-w-0 flex-1 sm:max-w-xl"
          actions={
            <>
              <Button type="submit" pending={pending && rows.length === 0}>
                {t('search')}
              </Button>
              {query === undefined ? null : (
                <Button
                  type="reset"
                  variant="secondary"
                  onClick={() => {
                    setQuery(undefined);
                    readFirst({ sort: readWith.current.sort, q: undefined });
                  }}
                >
                  {t('clearSearch')}
                </Button>
              )}
            </>
          }
        >
          <Input name="q" type="search" maxLength={80} autoComplete="off" />
        </Field>
      </form>
      <FailureMessage failure={failure} />
      {truncated ? (
        <p role="status" className="text-text-muted text-sm">
          {t('truncated')}
        </p>
      ) : null}
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pending && rows.length === 0}
        {...view.grid}
        toolbar={
          <ViewsMenu
            screen="customers"
            current={view.settings}
            standard={view.standard}
            onApply={view.apply}
          />
        }
        empty={<EmptyState message={query === undefined ? t('empty') : t('emptySearch')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending }
        }
      />
    </div>
  );
}
