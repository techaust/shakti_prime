'use client';

import type { ImportJobDto, ImportRowDto, ImportRowPage } from '@shakti/contracts';
import { DataGrid, EmptyState, Field, Select, StatusBadge, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { listImportRows } from '../../actions/imports';
import {
  formatCount,
  ROW_STATE_TONE,
  ROW_VIEWS,
  rowFindings,
  rowStateOf,
  rowValue,
  type RowFinding,
  type RowView,
} from '../../screens/import-wizard';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

const PAGE = 50;

/**
 * The rows of a file with what was found on each: the sentence for every problem, rows repeated
 * in the file and customers who may already exist. A choice of rows to show, a page at a time.
 */
export function RowsGrid({
  job,
  initial,
  initialView,
}: {
  job: ImportJobDto;
  initial: ImportRowPage;
  initialView: RowView;
}) {
  const t = useTranslations('imports.check');
  const fields = useTranslations('imports.fields');
  const rowErrors = useTranslations('imports.rowErrors');
  const common = useTranslations('common');
  const [view, setView] = useState<RowView>(initialView);
  const [rows, setRows] = useState(initial.rows);
  const [customers, setCustomers] = useState(initial.customers);
  const [nextAfter, setNextAfter] = useState(initial.nextAfter);
  const { load, pending, failure } = useQuery<ImportRowPage>();

  function read(next: RowView, after: number | undefined) {
    const state = rowStateOf(next);
    load(
      () =>
        listImportRows({
          entityId: job.entityId,
          jobId: job.id,
          limit: PAGE,
          ...(state === undefined ? {} : { state }),
          ...(after === undefined ? {} : { after }),
        }),
      (page) => {
        setRows((all) => (after === undefined ? page.rows : [...all, ...page.rows]));
        setCustomers((all) => ({ ...all, ...page.customers }));
        setNextAfter(page.nextAfter);
      },
    );
  }

  function finding(f: RowFinding): string {
    switch (f.kind) {
      case 'error':
        return t('finding.field', { field: fields(f.field), sentence: rowErrors(f.code) });
      case 'sameAsRow':
        return t('finding.sameAsRow', { row: formatCount(f.rowNo) });
      case 'customer':
        return f.name === undefined
          ? t('finding.customerHidden')
          : t('finding.customer', { name: f.name });
    }
  }

  const notRecorded = <span className="text-text-muted">{t('notRecorded')}</span>;
  const columns: DataGridColumn<ImportRowDto>[] = [
    {
      id: 'row',
      header: t('columns.row'),
      numeric: true,
      cell: (r) => formatCount(r.rowNo),
    },
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      cell: (r) => rowValue(r, job.mapping, 'contactName') || notRecorded,
    },
    {
      id: 'phone',
      header: t('columns.phone'),
      numeric: true,
      cell: (r) => rowValue(r, job.mapping, 'phone') || notRecorded,
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (r) => (
        <StatusBadge tone={ROW_STATE_TONE[r.state]}>{t(`rowState.${r.state}`)}</StatusBadge>
      ),
    },
    {
      id: 'findings',
      header: t('columns.findings'),
      className: 'py-2 whitespace-normal',
      cell: (r) => {
        const found = rowFindings(r, customers);
        return found.length === 0 ? null : (
          <ul className="flex max-w-prose flex-col gap-1 text-sm">
            {found.map((f, i) => (
              <li key={i} className={f.kind === 'error' ? 'text-danger' : 'text-text-muted'}>
                {finding(f)}
              </li>
            ))}
          </ul>
        );
      },
    },
  ];

  return (
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby="import-rows-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="import-rows-title" className="text-h3">
          {t('caption')}
        </h2>
        <Field id="import-rows-view" label={t('view')} className="w-full sm:w-72">
          <Select
            value={view}
            onChange={(e) => {
              const next = e.currentTarget.value as RowView;
              setView(next);
              setRows([]);
              setNextAfter(null);
              read(next, undefined);
            }}
          >
            {ROW_VIEWS.map((v) => (
              <option key={v} value={v}>
                {t(`views.${v}`)}
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
        rowKey={(r) => String(r.rowNo)}
        loading={pending}
        density="compact"
        empty={<EmptyState message={t('empty')} />}
        loadMore={
          nextAfter === null
            ? undefined
            : {
                label: common('loadMore'),
                onLoadMore: () => {
                  read(view, nextAfter);
                },
                pending,
              }
        }
      />
    </section>
  );
}
