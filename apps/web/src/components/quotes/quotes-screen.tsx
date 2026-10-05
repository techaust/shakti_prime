'use client';

import type { QuotePageDto, QuoteRowDto, QuoteState } from '@shakti/contracts';
import {
  DataGrid,
  EmptyState,
  Field,
  Select,
  StatusBadge,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { listQuotes } from '../../actions/quotes';
import { QUOTE_STATES } from '../../screens/contract-values';
import { isOneOf } from '../../screens/customers';
import { formatDate, formatRupees } from '../../screens/format';
import { QUOTE_STATE_TONE, quoteHref } from '../../screens/quotes';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

const PAGE_SIZE = 50;

/**
 * `/quotes` (docs/design/phase1.md §7.3): the quotes of the caller's leads, newest first, a page at
 * a time, with a choice of status. A quote past its validity shows as expired.
 */
export function QuotesScreen({
  initial,
  companies,
  showCompany,
}: {
  initial: QuotePageDto;
  companies: Record<number, string>;
  showCompany: boolean;
}) {
  const t = useTranslations('quotes');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [state, setState] = useState<QuoteState | undefined>();
  const { load, pending, failure } = useQuery<QuotePageDto>();
  // The status the rows on screen were read for; an older answer is dropped.
  const readFor = useRef<QuoteState | undefined>(undefined);

  function readFirst(next: QuoteState | undefined) {
    readFor.current = next;
    setState(next);
    setRows([]);
    setNextCursor(null);
    load(
      () => listQuotes({ limit: PAGE_SIZE, ...(next === undefined ? {} : { state: next }) }),
      (page) => {
        if (readFor.current !== next) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
      },
    );
  }

  function loadMore() {
    if (nextCursor === null) return;
    const now = readFor.current;
    load(
      () =>
        listQuotes({
          limit: PAGE_SIZE,
          cursor: nextCursor,
          ...(now === undefined ? {} : { state: now }),
        }),
      (page) => {
        if (readFor.current !== now) return;
        setRows((all) => [...all, ...page.items]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  const columns: DataGridColumn<QuoteRowDto>[] = [
    {
      id: 'number',
      header: t('columns.number'),
      primary: true,
      cell: (r) => (
        <Link
          href={quoteHref(r.entityId, r.id)}
          className="text-accent-text tabular-nums hover:underline"
        >
          {r.quoteNo}
        </Link>
      ),
    },
    { id: 'customer', header: t('columns.customer'), cell: (r) => r.customerName },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (r) => <StatusBadge tone={QUOTE_STATE_TONE[r.state]}>{t(`state.${r.state}`)}</StatusBadge>,
    },
    {
      id: 'total',
      header: t('columns.total'),
      numeric: true,
      cell: (r) => formatRupees(r.grandTotal),
    },
    {
      id: 'validUntil',
      header: t('columns.validUntil'),
      cell: (r) => <time dateTime={r.validUntil}>{formatDate(r.validUntil)}</time>,
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
      <div className="max-w-xs">
        <Field id="quotes-state" label={t('filterState')}>
          <Select
            value={state ?? ''}
            onChange={(e) => {
              const value = e.currentTarget.value;
              readFirst(isOneOf(QUOTE_STATES, value) ? value : undefined);
            }}
          >
            <option value="">{t('allStates')}</option>
            {QUOTE_STATES.map((s) => (
              <option key={s} value={s}>
                {t(`state.${s}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pending && rows.length === 0}
        empty={<EmptyState message={state === undefined ? t('empty') : t('emptyState')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending }
        }
      />
    </div>
  );
}
