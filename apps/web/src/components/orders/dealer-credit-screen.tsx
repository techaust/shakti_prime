'use client';

import type { DealerCreditPageDto, DealerCreditRowDto } from '@shakti/contracts';
import { Button, DataGrid, EmptyState, Field, Select, type DataGridColumn } from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { listDealerCredit } from '../../actions/orders';
import { customerHref } from '../../screens/customers';
import { formatCount, formatDate, formatRupees } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import type { DealerCreditDialogKind } from './dealer-credit-dialogs';

// The entry forms and the history are loaded only when someone opens one.
const DealerCreditDialog = dynamic(() =>
  import('./dealer-credit-dialogs').then((m) => m.DealerCreditDialog),
);

const PAGE_SIZE = 50;

/**
 * `/dealer-credit` (docs/design/phase1.md §8.3, `sales.credit.write`): each dealer of one company
 * with its credit limit and days, its newest outstanding and the date it stands at, the confirmed
 * orders since that date, and the exposure the credit check reads; Accounts enter terms and
 * outstanding here, and each dealer's entries are kept and shown as its history.
 */
export function DealerCreditScreen({
  initial,
  entityId,
  companies,
}: {
  initial: DealerCreditPageDto;
  entityId: number;
  /** The companies the caller may choose between, by id. */
  companies: Record<number, string>;
}) {
  const t = useTranslations('dealerCredit');
  const common = useTranslations('common');
  const router = useRouter();
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [open, setOpen] = useState<
    { kind: DealerCreditDialogKind; dealer: DealerCreditRowDto } | undefined
  >();
  const { load, pending, failure } = useQuery<DealerCreditPageDto>();

  function reload() {
    load(
      () => listDealerCredit({ entityId, limit: PAGE_SIZE }),
      (page) => {
        setRows(page.items);
        setNextCursor(page.nextCursor);
      },
    );
  }

  const ask = (kind: DealerCreditDialogKind, dealer: DealerCreditRowDto) => {
    setOpen({ kind, dealer });
  };

  const columns: DataGridColumn<DealerCreditRowDto>[] = [
    {
      id: 'dealer',
      header: t('columns.dealer'),
      primary: true,
      cell: (r) => (
        <Link
          href={customerHref(r.accountId, entityId)}
          className="text-accent-text hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    {
      id: 'limit',
      header: t('columns.limit'),
      numeric: true,
      cell: (r) => (r.creditLimit === null ? t('notSet') : formatRupees(r.creditLimit)),
    },
    {
      id: 'days',
      header: t('columns.days'),
      numeric: true,
      cell: (r) =>
        r.creditDays === null ? t('notSet') : t('days', { days: formatCount(r.creditDays) }),
    },
    {
      id: 'outstanding',
      header: t('columns.outstanding'),
      numeric: true,
      cell: (r) =>
        r.outstanding === null || r.asOf === null ? (
          t('notEntered')
        ) : (
          <span className="flex flex-col items-end">
            <span>{formatRupees(r.outstanding)}</span>
            <span className="text-text-muted text-xs">
              {t('asOf', { date: formatDate(r.asOf) })}
            </span>
          </span>
        ),
    },
    {
      id: 'overdue',
      header: t('columns.overdue'),
      cell: (r) =>
        r.oldestOverdueInvoiceNo === null
          ? t('noneOverdue')
          : t('overdue', {
              invoice: r.oldestOverdueInvoiceNo,
              days: formatCount(r.oldestOverdueDays ?? 0),
            }),
    },
    {
      id: 'confirmed',
      header: t('columns.confirmed'),
      numeric: true,
      cell: (r) => formatRupees(r.confirmedUnpaid),
    },
    {
      id: 'exposure',
      header: t('columns.exposure'),
      numeric: true,
      cell: (r) => formatRupees(r.exposure),
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('setTermsFor', { name: r.name })}
            onClick={() => {
              ask('terms', r);
            }}
          >
            {t('setTerms')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('enterOutstandingFor', { name: r.name })}
            onClick={() => {
              ask('outstanding', r);
            }}
          >
            {t('enterOutstanding')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('historyFor', { name: r.name })}
            onClick={() => {
              ask('history', r);
            }}
          >
            {t('history')}
          </Button>
        </span>
      ),
    },
  ];

  const ids = Object.keys(companies).map(Number);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {ids.length > 1 ? (
        <div className="max-w-xs">
          <Field id="dealer-credit-company" label={t('company')}>
            <Select
              value={String(entityId)}
              onChange={(e) => {
                router.push(`/dealer-credit?company=${e.currentTarget.value}` as Route);
              }}
            >
              {ids.map((id) => (
                <option key={id} value={id}>
                  {companies[id]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.accountId}
        loading={pending && rows.length === 0}
        empty={<EmptyState message={t('empty')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : {
                label: common('loadMore'),
                onLoadMore: () => {
                  load(
                    () => listDealerCredit({ entityId, limit: PAGE_SIZE, cursor: nextCursor }),
                    (page) => {
                      setRows((all) => [...all, ...page.items]);
                      setNextCursor(page.nextCursor);
                    },
                  );
                },
                pending,
              }
        }
      />
      {open === undefined ? null : (
        <DealerCreditDialog
          kind={open.kind}
          entityId={entityId}
          dealer={open.dealer}
          onClose={() => {
            setOpen(undefined);
          }}
          onSaved={() => {
            setOpen(undefined);
            reload();
          }}
        />
      )}
    </div>
  );
}
