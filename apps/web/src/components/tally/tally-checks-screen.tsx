'use client';

import type { HeldTallySnapshotDto } from '@shakti/contracts';
import { Button, DataGrid, EmptyState, Skeleton, toast, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { confirmTallySnapshot, listHeldTallySnapshots } from '../../actions/tally';
import { formatCount } from '../../screens/format';
import { DateTime } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';

/**
 * Tally checks (TC2, docs/03-roadmap-appendix/phase5.md §6.3): each day the connector sends every
 * record Tally holds, and a record missing from it was deleted or cancelled in Tally. A check that
 * would mark more than a tenth of a company's records (and more than twenty) as removed is far
 * likelier a wrong company or an empty export, so it waits here until Accounts confirm it
 * (`finance.recon.write`); a newer check of the company replaces it.
 */
export function TallyChecksScreen({ companies }: { companies: Record<number, string> }) {
  const t = useTranslations('tallyChecks');
  const { load, failure } = useQuery<HeldTallySnapshotDto[]>();
  const [held, setHeld] = useState<HeldTallySnapshotDto[] | undefined>();
  const confirm = useCommand(confirmTallySnapshot);

  const reload = useCallback(() => {
    load(() => listHeldTallySnapshots(), setHeld);
  }, [load]);

  useEffect(() => {
    reload();
  }, [reload]);

  const columns: DataGridColumn<HeldTallySnapshotDto>[] = [
    {
      id: 'company',
      header: t('columns.company'),
      primary: true,
      cell: (r) => (
        <span>
          {companies[r.entityId] ?? t('otherCompany')}
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
  );
}
