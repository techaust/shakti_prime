'use client';

import type { EmployeePageDto, EmployeeRowDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  Field,
  Input,
  StatusBadge,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { listEmployees } from '../../actions/hr';
import { formatDate } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import { companyName, type CompanyOption } from './hr-text';

/** The employee form, fetched when first opened rather than with the page. */
const EmployeeFormDialog = dynamic(() =>
  import('./employee-form').then((m) => m.EmployeeFormDialog),
);

const PAGE_SIZE = 50;

interface Filters {
  q: string;
  includeLeft: boolean;
}

/**
 * HR › People (docs/03-roadmap-appendix/phase5.md §5, PRD HR-01): the people the caller may read,
 * by name, searched on the server. A name opens the person's page; HR adds people.
 */
export function PeopleScreen({
  initialPage,
  canEdit,
  companies,
}: {
  initialPage: EmployeePageDto;
  canEdit: boolean;
  /** The companies of the request, which a new person may join. */
  companies: readonly CompanyOption[];
}) {
  const t = useTranslations('hr.people');
  const hr = useTranslations('hr');
  const common = useTranslations('common');
  const router = useRouter();
  const [rows, setRows] = useState<EmployeeRowDto[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [filters, setFilters] = useState<Filters>({ q: '', includeLeft: false });
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const { load, pending, failure } = useQuery<EmployeePageDto>();
  const [loadingMore, setLoadingMore] = useState(false);
  const wanted = useRef<Filters>(filters);
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(typing.current);
    },
    [],
  );

  const query = (f: Filters) => ({
    ...(f.q.trim().length === 0 ? {} : { q: f.q.trim() }),
    includeLeft: f.includeLeft,
  });

  function readFirstPage(f: Filters) {
    wanted.current = f;
    setLoadingMore(false);
    load(
      () => listEmployees({ limit: PAGE_SIZE, ...query(f) }),
      (page) => {
        if (wanted.current !== f) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
      },
    );
  }

  function changeFilters(next: Filters, wait: boolean) {
    setFilters(next);
    clearTimeout(typing.current);
    if (!wait) {
      readFirstPage(next);
      return;
    }
    typing.current = setTimeout(() => {
      readFirstPage(next);
    }, 300);
  }

  function loadMore() {
    if (nextCursor === null) return;
    const asked = wanted.current;
    setLoadingMore(true);
    load(
      () => listEmployees({ limit: PAGE_SIZE, cursor: nextCursor, ...query(asked) }),
      (page) => {
        if (wanted.current !== asked) return;
        setRows((all) => [...all, ...page.items]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      },
    );
  }

  const columns: DataGridColumn<EmployeeRowDto>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      primary: true,
      cell: (r) => (
        <Link href={`/hr/people/${r.id}`} className="text-accent-text hover:underline">
          {r.name}
        </Link>
      ),
    },
    ...(companies.length > 1
      ? [
          {
            id: 'company',
            header: t('columns.company'),
            cell: (r: EmployeeRowDto) => companyName(companies, r.entityId),
          },
        ]
      : []),
    { id: 'manager', header: t('columns.manager'), cell: (r) => r.managerName ?? hr('none') },
    { id: 'shift', header: t('columns.shift'), cell: (r) => r.shiftName ?? hr('none') },
    { id: 'office', header: t('columns.office'), cell: (r) => r.office ?? hr('none') },
    { id: 'joined', header: t('columns.joined'), cell: (r) => formatDate(r.joinedOn) },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (r) => (
        <StatusBadge tone={r.active ? 'success' : 'neutral'}>
          {r.active ? hr('onStaff') : hr('left')}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-2 md:w-72">
          <Field id="people-search" label={t('search')} helper={t('searchHelper')}>
            <Input
              type="search"
              autoComplete="off"
              value={filters.q}
              onChange={(e) => {
                changeFilters({ ...filters, q: e.currentTarget.value }, true);
              }}
            />
          </Field>
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="checkbox"
              className="accent-accent size-4"
              checked={filters.includeLeft}
              onChange={(e) => {
                changeFilters({ ...filters, includeLeft: e.currentTarget.checked }, false);
              }}
            />
            {t('showLeft')}
          </label>
        </div>
        {canEdit && companies.length > 0 ? (
          <Button
            ref={addButton}
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('add')}
          </Button>
        ) : null}
      </div>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pending && !loadingMore}
        empty={<EmptyState message={filters.q === '' ? t('empty') : t('noMatch')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending: loadingMore }
        }
      />
      {adding ? (
        <EmployeeFormDialog
          employee={undefined}
          companies={companies}
          returnFocusTo={() => [addButton.current]}
          onClose={() => {
            setAdding(false);
          }}
          onSaved={(employee) => {
            setAdding(false);
            router.push(`/hr/people/${employee.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
