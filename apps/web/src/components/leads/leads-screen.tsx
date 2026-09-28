'use client';

import type { LeadDto, PipelineDto } from '@shakti/contracts';
import type { LeadPage } from '@shakti/domain';
import {
  Button,
  DataGrid,
  EmptyState,
  sortRows,
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
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu } from '../screens/views-menu';

const STATE_TONE: Record<LeadDto['state'], StatusTone> = {
  open: 'accent',
  nurture: 'info',
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
  const view = useGridView({ density: 'compact' });
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
    {
      id: 'customer',
      header: t('columns.customer'),
      cell: (l) => l.account.name,
      sortValue: (l) => l.account.name,
      primary: true,
    },
    {
      id: 'contact',
      header: t('columns.contact'),
      cell: (l) => l.contact?.name ?? notRecorded,
      sortValue: (l) => l.contact?.name ?? null,
    },
    {
      id: 'phone',
      header: t('columns.phone'),
      numeric: true,
      sortValue: (l) => l.contact?.phone ?? null,
      cell: (l) =>
        l.contact?.phone == null ? (
          notRecorded
        ) : (
          <a href={`tel:${l.contact.phone}`} className="text-accent-text hover:underline">
            {formatPhone(l.contact.phone)}
          </a>
        ),
    },
    {
      id: 'stage',
      header: t('columns.stage'),
      cell: (l) => stages.get(l.stageId) ?? '',
      sortValue: (l) => stages.get(l.stageId) ?? null,
    },
    {
      id: 'status',
      header: t('columns.status'),
      sortValue: (l) => t(`state.${l.state}`),
      cell: (l) => <StatusBadge tone={STATE_TONE[l.state]}>{t(`state.${l.state}`)}</StatusBadge>,
    },
  ];
  if (showCompany) {
    columns.push({
      id: 'company',
      header: t('columns.company'),
      cell: (l) => companies[l.entityId] ?? '',
      sortValue: (l) => companies[l.entityId] ?? null,
    });
  }
  columns.push({
    id: 'updated',
    header: t('columns.updated'),
    numeric: true,
    cell: (l) => formatDateTime(l.updatedAt),
    sortValue: (l) => Date.parse(l.updatedAt),
  });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={sortRows(rows, columns, view.grid.sort)}
        rowKey={(l) => l.id}
        {...view.grid}
        toolbar={
          <ViewsMenu
            screen="leads"
            current={view.settings}
            standard={view.standard}
            onApply={view.apply}
          />
        }
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
