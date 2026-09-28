'use client';

import type { ImportJobDto, ImportJobPage } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  sortRows,
  StatusBadge,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { listImportJobs } from '../../actions/imports';
import { formatDateTime } from '../../screens/format';
import { formatCount, jobHref, JOB_STATE_TONE } from '../../screens/import-wizard';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu } from '../screens/views-menu';

/** Imports: the files added before, newest first, each opening at the step it waits at. */
export function ImportsScreen({
  initial,
  companies,
  showCompany,
}: {
  initial: ImportJobPage;
  companies: Record<number, string>;
  showCompany: boolean;
}) {
  const t = useTranslations('imports');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial.items);
  const [creators, setCreators] = useState(initial.creators);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const { load, pending, failure } = useQuery<ImportJobPage>();
  const view = useGridView({ density: 'compact' });

  function loadMore() {
    if (nextCursor === null) return;
    load(
      () => listImportJobs({ limit: 25, cursor: nextCursor }),
      (page) => {
        setRows((all) => [...all, ...page.items.filter((j) => !all.some((x) => x.id === j.id))]);
        setCreators((all) => ({ ...all, ...page.creators }));
        setNextCursor(page.nextCursor);
      },
    );
  }

  const columns: DataGridColumn<ImportJobDto>[] = [
    {
      id: 'file',
      header: t('columns.file'),
      primary: true,
      // A file name has no spaces to wrap at: keep the column readable and break only if needed.
      className: 'min-w-48',
      sortValue: (j) => j.file.name,
      cell: (j) => (
        <Link href={jobHref(j)} className="text-accent-text wrap-anywhere hover:underline">
          {j.file.name}
        </Link>
      ),
    },
    {
      id: 'status',
      header: t('columns.status'),
      sortValue: (j) => t(`state.${j.state}`),
      cell: (j) => (
        <StatusBadge tone={JOB_STATE_TONE[j.state]}>{t(`state.${j.state}`)}</StatusBadge>
      ),
    },
    {
      id: 'total',
      header: t('columns.total'),
      align: 'end',
      numeric: true,
      cell: (j) => formatCount(j.totalRows),
      sortValue: (j) => j.totalRows,
    },
    {
      id: 'valid',
      header: t('columns.valid'),
      align: 'end',
      numeric: true,
      cell: (j) => (j.state === 'uploaded' || j.state === 'mapped' ? '' : formatCount(j.validRows)),
      sortValue: (j) => (j.state === 'uploaded' || j.state === 'mapped' ? null : j.validRows),
    },
    {
      id: 'committed',
      header: t('columns.committed'),
      align: 'end',
      numeric: true,
      cell: (j) => formatCount(j.committedRows),
      sortValue: (j) => j.committedRows,
    },
  ];
  if (showCompany) {
    columns.push({
      id: 'company',
      header: t('columns.company'),
      cell: (j) => companies[j.entityId] ?? '',
      sortValue: (j) => companies[j.entityId] ?? null,
    });
  }
  columns.push(
    {
      id: 'startedBy',
      header: t('columns.startedBy'),
      cell: (j) => creators[j.createdBy] ?? t('formerMember'),
      sortValue: (j) => creators[j.createdBy] ?? null,
    },
    {
      id: 'started',
      header: t('columns.started'),
      numeric: true,
      cell: (j) => formatDateTime(j.createdAt),
      sortValue: (j) => Date.parse(j.createdAt),
    },
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={sortRows(rows, columns, view.grid.sort)}
        rowKey={(j) => j.id}
        {...view.grid}
        toolbar={
          <ViewsMenu
            screen="imports"
            current={view.settings}
            standard={view.standard}
            onApply={view.apply}
          />
        }
        empty={
          <EmptyState
            message={t('empty')}
            action={
              <Button asChild>
                <Link href="/imports/new">{t('add')}</Link>
              </Button>
            }
          />
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
