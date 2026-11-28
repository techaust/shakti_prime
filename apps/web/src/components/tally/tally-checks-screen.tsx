'use client';

import type {
  HeldTallySnapshotDto,
  HeldTallyVoucherDto,
  HeldTallyVoucherPageDto,
} from '@shakti/contracts';
import { Button, DataGrid, EmptyState, Skeleton, toast, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  confirmTallySnapshot,
  listHeldTallySnapshots,
  listHeldTallyVouchers,
} from '../../actions/tally';
import { formatCount, formatDate } from '../../screens/format';
import { DateTime } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

/** Records shown at a time under a check. */
const PAGE_SIZE = 50;

/**
 * Tally checks (TC2, docs/03-roadmap-appendix/phase5.md §6.3): each day the connector sends every
 * record Tally holds, and a record missing from it was deleted or cancelled in Tally. A check that
 * would mark more than a tenth of a company's records (and more than twenty) as removed is far
 * likelier a wrong company or an empty export, so it waits here until Accounts confirm it
 * (`finance.recon.write`); a newer check of the company replaces it. Each check lists the records
 * it would mark removed (number, date, party and type), a page at a time, to compare with Tally
 * before confirming.
 */
export function TallyChecksScreen({ companies }: { companies: Record<number, string> }) {
  const t = useTranslations('tallyChecks');
  const { load, failure } = useQuery<HeldTallySnapshotDto[]>();
  const [held, setHeld] = useState<HeldTallySnapshotDto[] | undefined>();
  const [shown, setShown] = useState<HeldTallySnapshotDto | undefined>();
  const confirm = useCommand(confirmTallySnapshot);

  const reload = useCallback(() => {
    load(
      () => listHeldTallySnapshots(),
      (rows) => {
        setHeld(rows);
        setShown((open) => rows.find((r) => r.snapshotId === open?.snapshotId));
      },
    );
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);

  const companyOf = (r: HeldTallySnapshotDto) => companies[r.entityId] ?? t('otherCompany');

  const columns: DataGridColumn<HeldTallySnapshotDto>[] = [
    {
      id: 'company',
      header: t('columns.company'),
      primary: true,
      cell: (r) => (
        <span>
          {companyOf(r)}
          <span className="block text-text-muted">{r.tallyCompany}</span>
        </span>
      ),
    },
    { id: 'taken', header: t('columns.taken'), cell: (r) => <DateTime value={r.asOf} /> },
    {
      id: 'remove',
      header: t('columns.wouldRemove'),
      numeric: true,
      cell: (r) => <span data-dynamic>{formatCount(r.wouldRemove)}</span>,
    },
    {
      id: 'live',
      header: t('columns.live'),
      numeric: true,
      cell: (r) => <span data-dynamic>{formatCount(r.live)}</span>,
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      cell: (r) => (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('seeRecordsLabel', { company: r.tallyCompany })}
            aria-pressed={shown?.snapshotId === r.snapshotId}
            onClick={() => {
              setShown(shown?.snapshotId === r.snapshotId ? undefined : r);
            }}
          >
            {t('seeRecords')}
          </Button>
          <Button
            size="sm"
            pending={confirm.pending}
            aria-label={t('confirmLabel', { company: r.tallyCompany })}
            onClick={() => {
              confirm.run({ entityId: r.entityId, snapshotId: r.snapshotId }, (done) => {
                toast.success(t('confirmed', { count: done.tombstoned }));
                reload();
              });
            }}
          >
            {t('confirmCheck')}
          </Button>
        </div>
      ),
    },
  ];

  if (held === undefined) {
    return failure === undefined ? (
      <Skeleton className="h-40 w-full" />
    ) : (
      <FailureMessage failure={failure} />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <DataGrid
          caption={t('caption')}
          columns={columns}
          rows={held}
          rowKey={(r) => r.snapshotId}
          empty={<EmptyState message={t('empty')} />}
        />
        <FailureMessage failure={confirm.failure} />
      </div>
      {shown === undefined ? null : (
        <HeldRecords key={shown.snapshotId} check={shown} company={companyOf(shown)} />
      )}
    </div>
  );
}

/** The records one held check would mark removed, newest first, a page at a time. */
function HeldRecords({ check, company }: { check: HeldTallySnapshotDto; company: string }) {
  const t = useTranslations('tallyChecks');
  const common = useTranslations('common');
  const id = useId();
  const { load, pending, failure } = useQuery<HeldTallyVoucherPageDto>();
  const [page, setPage] = useState<HeldTallyVoucherPageDto | undefined>();

  useEffect(() => {
    load(
      () => listHeldTallyVouchers({ snapshotId: check.snapshotId, limit: PAGE_SIZE }),
      setPage,
    );
  }, [load, check.snapshotId]);

  function loadMore() {
    const cursor = page?.nextCursor;
    if (cursor === undefined || cursor === null) return;
    load(
      () => listHeldTallyVouchers({ snapshotId: check.snapshotId, limit: PAGE_SIZE, cursor }),
      (next) => {
        setPage((all) =>
          all === undefined ? next : { ...next, items: [...all.items, ...next.items] },
        );
      },
    );
  }

  const columns: DataGridColumn<HeldTallyVoucherDto>[] = [
    {
      id: 'number',
      header: t('records.number'),
      primary: true,
      cell: (v) => (
        <span data-dynamic>{v.voucherNo === '' ? t('records.noNumber') : v.voucherNo}</span>
      ),
    },
    {
      id: 'date',
      header: t('records.date'),
      cell: (v) => (
        <time dateTime={v.voucherDate} data-dynamic>
          {formatDate(v.voucherDate)}
        </time>
      ),
    },
    {
      id: 'party',
      header: t('records.party'),
      cell: (v) => <span data-dynamic>{v.partyName ?? t('records.noParty')}</span>,
    },
    { id: 'type', header: t('records.type'), cell: (v) => t(`voucherType.${v.type}`) },
  ];

  // Purchases and debit notes show only to those who read supplier rates.
  const hidden = page === undefined ? 0 : Math.max(0, check.wouldRemove - page.total);
  return (
    <section aria-labelledby={`${id}-records`} className="flex flex-col gap-3">
      <h2 id={`${id}-records`} className="text-h2">
        {t('records.heading', { company, tally: check.tallyCompany })}
      </h2>
      <p className="text-text-muted text-sm">{t('records.intro')}</p>
      {page === undefined ? (
        failure === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <FailureMessage failure={failure} />
        )
      ) : (
        <>
          <DataGrid
            caption={t('records.caption', { count: page.total })}
            columns={columns}
            rows={page.items}
            rowKey={(v) => v.guid}
            empty={<EmptyState message={t('records.none')} />}
            loadMore={
              page.nextCursor === null
                ? undefined
                : { label: common('loadMore'), onLoadMore: loadMore, pending }
            }
          />
          {hidden === 0 ? null : (
            <p className="text-text-muted text-sm">{t('records.hidden', { count: hidden })}</p>
          )}
          <FailureMessage failure={failure} />
        </>
      )}
    </section>
  );
}
