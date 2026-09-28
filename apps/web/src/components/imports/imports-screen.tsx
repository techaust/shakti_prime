'use client';

import type { ImportJobDto, ImportJobPage, ImportJobSort } from '@shakti/contracts';
import { Button, DataGrid, EmptyState, StatusBadge, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { listImportJobs } from '../../actions/imports';
import { IMPORT_JOB_SORT_COLUMNS } from '../../screens/contract-values';
import { formatDateTime } from '../../screens/format';
import { formatCount, jobHref, JOB_STATE_TONE } from '../../screens/import-wizard';
import { FailureMessage } from '../screens/failure';
import { sortInput, toListSort } from '../screens/list-sort';
import { useQuery } from '../screens/use-command';
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu } from '../screens/views-menu';

const PAGE_SIZE = 25;

/**
 * Imports: the files added before, newest first, each opening at the step it waits at. Sorted
 * on the server over every job (`IMPORT_JOB_SORT_COLUMNS`); the status and the company are not,
 * because their shown names do not come from the jobs.
 */
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
  // The order the rows on screen were read in; an answer read in an older order is dropped.
  const sorted = useRef<ImportJobSort | undefined>(undefined);
  const view = useGridView({
    density: 'compact',
    onSortChange: (next) => {
      const sort = toListSort(next, IMPORT_JOB_SORT_COLUMNS);
      sorted.current = sort;
      setRows([]);
      setNextCursor(null);
      load(
        () => listImportJobs({ limit: PAGE_SIZE, ...sortInput(sort) }),
        (page) => {
          if (sorted.current !== sort) return;
          setRows(page.items);
          setCreators((all) => ({ ...all, ...page.creators }));
          setNextCursor(page.nextCursor);
        },
      );
    },
  });

  function loadMore() {
    if (nextCursor === null) return;
    const sort = sorted.current;
    load(
      () => listImportJobs({ limit: PAGE_SIZE, cursor: nextCursor, ...sortInput(sort) }),
      (page) => {
        if (sorted.current !== sort) return;
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
      sortable: true,
      cell: (j) => (
        <Link href={jobHref(j)} className="text-accent-text wrap-anywhere hover:underline">
          {j.file.name}
        </Link>
      ),
    },
    {
      id: 'status',
      header: t('columns.status'),
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
      sortable: true,
    },
    {
      id: 'valid',
      header: t('columns.valid'),
      align: 'end',
      numeric: true,
      cell: (j) => (j.state === 'uploaded' || j.state === 'mapped' ? '' : formatCount(j.validRows)),
      sortable: true,
    },
    {
      id: 'committed',
      header: t('columns.committed'),
      align: 'end',
      numeric: true,
      cell: (j) => formatCount(j.committedRows),
      sortable: true,
    },
  ];
  if (showCompany) {
    columns.push({
      id: 'company',
      header: t('columns.company'),
      cell: (j) => companies[j.entityId] ?? '',
    });
  }
  columns.push(
    {
      id: 'startedBy',
      header: t('columns.startedBy'),
      cell: (j) => creators[j.createdBy] ?? t('formerMember'),
      sortable: true,
    },
    {
      id: 'started',
      header: t('columns.started'),
      numeric: true,
      cell: (j) => formatDateTime(j.createdAt),
      sortable: true,
    },
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(j) => j.id}
        loading={pending && rows.length === 0}
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
