'use client';

import type { LeadDto, PipelineDto } from '@shakti/contracts';
import type { LeadPage } from '@shakti/domain';
import {
  Button,
  DataGrid,
  EmptyState,
  StatusBadge,
  type DataGridColumn,
  type StatusTone,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { listLeads } from '../../actions/crm';
import { formatDateTime, formatPhone } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

const STATE_TONE: Record<LeadDto['state'], StatusTone> = {
  open: 'accent',
  won: 'success',
  lost: 'neutral',
};

/** The leads grid with Load more; stage names come from the pipelines the lead form uses. */
export function LeadsScreen({
  initial,
  pipelines,
  companies,
  showCompany,
  canAdd,
}: {
  initial: LeadPage;
  pipelines: PipelineDto[];
  companies: Record<number, string>;
  showCompany: boolean;
  canAdd: boolean;
}) {
  const t = useTranslations('leads');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const { load, pending, failure } = useQuery<LeadPage>();
  const stages = new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s.name] as const)));

  function loadMore() {
    if (nextCursor === null) return;
    load(
      () => listLeads({ limit: 50, cursor: nextCursor }),
      (page) => {
        setRows((all) => [...all, ...page.items]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  const notRecorded = <span className="text-text-muted">{t('notRecorded')}</span>;
  const columns: DataGridColumn<LeadDto>[] = [
    { id: 'customer', header: t('columns.customer'), cell: (l) => l.account.name, primary: true },
    { id: 'contact', header: t('columns.contact'), cell: (l) => l.contact?.name ?? notRecorded },
    {
      id: 'phone',
      header: t('columns.phone'),
      numeric: true,
      cell: (l) =>
        l.contact?.phone == null ? (
          notRecorded
        ) : (
          <a href={`tel:${l.contact.phone}`} className="text-accent-text hover:underline">
            {formatPhone(l.contact.phone)}
          </a>
        ),
    },
    { id: 'stage', header: t('columns.stage'), cell: (l) => stages.get(l.stageId) ?? '' },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (l) => <StatusBadge tone={STATE_TONE[l.state]}>{t(`state.${l.state}`)}</StatusBadge>,
    },
  ];
  if (showCompany) {
    columns.push({
      id: 'company',
      header: t('columns.company'),
      cell: (l) => companies[l.entityId] ?? '',
    });
  }
  columns.push({
    id: 'updated',
    header: t('columns.updated'),
    numeric: true,
    cell: (l) => formatDateTime(l.updatedAt),
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(l) => l.id}
        density="compact"
        empty={
          canAdd ? (
            <EmptyState
              message={t('empty')}
              action={
                <Button asChild>
                  <Link href="/leads/new">{t('add')}</Link>
                </Button>
              }
            />
          ) : (
            <EmptyState message={t('emptyReadOnly')} />
          )
        }
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending }
        }
      />
    </div>
  );
}
