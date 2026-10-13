'use client';

import type { SalesOrderPageDto, SalesOrderRowDto, SalesOrderState } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState, type SyntheticEvent } from 'react';
import { listOrders } from '../../actions/orders';
import { SEARCH_MIN_CHARS } from '../../screens/contract-values';
import { isOneOf } from '../../screens/customers';
import { formatDate, formatRupees } from '../../screens/format';
import { ORDER_FILTER_STATES, ORDER_STATE_TONE, orderHref } from '../../screens/orders';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useQuery } from '../screens/use-command';

const PAGE_SIZE = 50;

/**
 * `/orders` (docs/03-roadmap-appendix/phase1.md §8.3): the orders the caller reads, newest first, a page at a
 * time, with a choice of status and a search by any part of the order number (RPT-03). An order
 * held for credit says so.
 */
export function OrdersScreen({
  initial,
  companies,
  showCompany,
}: {
  initial: SalesOrderPageDto;
  companies: Record<number, string>;
  showCompany: boolean;
}) {
  const t = useTranslations('orders');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [state, setState] = useState<SalesOrderState | undefined>();
  const [query, setQuery] = useState<string | undefined>();
  // Whether the last search took its most candidates, so older matches may be left out.
  const [capped, setCapped] = useState(initial.searchCapped);
  // A search of fewer letters than a search needs is refused with the reason (not run unseen).
  const [tooShort, setTooShort] = useState(false);
  const { load, pending, failure } = useQuery<SalesOrderPageDto>();
  // The status and number the rows on screen were read for; an older answer is dropped.
  const readFor = useRef<{ state: SalesOrderState | undefined; q: string | undefined }>({
    state: undefined,
    q: undefined,
  });

  function read(
    next: { state: SalesOrderState | undefined; q: string | undefined },
    cursor: string | null,
  ) {
    readFor.current = next;
    load(
      () =>
        listOrders({
          limit: PAGE_SIZE,
          ...(cursor === null ? {} : { cursor }),
          ...(next.state === undefined ? {} : { state: next.state }),
          ...(next.q === undefined ? {} : { q: next.q }),
        }),
      (page) => {
        if (readFor.current !== next) return;
        setRows((all) => (cursor === null ? page.items : [...all, ...page.items]));
        setNextCursor(page.nextCursor);
        setCapped(page.searchCapped);
      },
    );
  }

  function readFirst(next: { state: SalesOrderState | undefined; q: string | undefined }) {
    setRows([]);
    setNextCursor(null);
    read(next, null);
  }

  function search(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = formText(new FormData(e.currentTarget), 'q').trim();
    if (text.length > 0 && text.length < SEARCH_MIN_CHARS) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    const q = text === '' ? undefined : text;
    setQuery(q);
    readFirst({ state, q });
  }

  const columns: DataGridColumn<SalesOrderRowDto>[] = [
    {
      id: 'number',
      header: t('columns.number'),
      primary: true,
      cell: (r) => (
        <Link
          href={orderHref(r.entityId, r.id)}
          className="text-accent-text tabular-nums hover:underline"
        >
          {r.soNo}
        </Link>
      ),
    },
    { id: 'customer', header: t('columns.customer'), cell: (r) => r.customerName },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (r) =>
        r.creditHeld ? (
          <StatusBadge tone="warning">{t('heldForCredit')}</StatusBadge>
        ) : (
          <StatusBadge tone={ORDER_STATE_TONE[r.state]}>{t(`state.${r.state}`)}</StatusBadge>
        ),
    },
    {
      id: 'source',
      header: t('columns.source'),
      cell: (r) => (r.quoteId === null ? t('fromDealer') : t('fromQuote')),
    },
    {
      id: 'total',
      header: t('columns.total'),
      numeric: true,
      cell: (r) => formatRupees(r.grandTotal),
    },
    {
      id: 'created',
      header: t('columns.created'),
      cell: (r) => <time dateTime={r.createdAt}>{formatDate(r.createdAt)}</time>,
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
          id="orders-search"
          label={t('searchLabel')}
          helper={t('searchHelper')}
          error={tooShort ? t('searchTooShort') : undefined}
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
                    setTooShort(false);
                    readFirst({ state, q: undefined });
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
      <div className="max-w-xs">
        <Field id="orders-state" label={t('filterState')}>
          <Select
            value={state ?? ''}
            onChange={(e) => {
              const value = e.currentTarget.value;
              const next = isOneOf(ORDER_FILTER_STATES, value) ? value : undefined;
              setState(next);
              readFirst({ state: next, q: query });
            }}
          >
            <option value="">{t('allStates')}</option>
            {ORDER_FILTER_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`state.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FailureMessage failure={failure} />
      {query !== undefined && capped ? (
        <p role="status" className="text-text-muted text-sm">
          {t('searchCapped')}
        </p>
      ) : null}
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pending && rows.length === 0}
        empty={
          <EmptyState
            message={
              query !== undefined
                ? t('emptySearch')
                : state === undefined
                  ? t('empty')
                  : t('emptyState')
            }
          />
        }
        loadMore={
          nextCursor === null
            ? undefined
            : {
                label: common('loadMore'),
                onLoadMore: () => {
                  read(readFor.current, nextCursor);
                },
                pending,
              }
        }
      />
    </div>
  );
}
