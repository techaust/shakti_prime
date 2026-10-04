'use client';

import type { KitDto, KitPageDto, KitSort } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  Field,
  Input,
  StatusBadge,
  useFocusTargets,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { listKits } from '../../actions/catalogue';
import { KIT_SORT_COLUMNS } from '../../screens/contract-values';
import { formatCount, formatDate } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { sortInput, toListSort } from '../screens/list-sort';
import { useQuery } from '../screens/use-command';
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu } from '../screens/views-menu';

/** The kit sheet and the kit form, fetched when first opened rather than with the page. */
const KitSheet = dynamic(() => import('./kit-sheet').then((m) => m.KitSheet));
const KitFormDialog = dynamic(() => import('./kit-form').then((m) => m.KitFormDialog));

const PAGE_SIZE = 50;

interface Filters {
  q: string;
  includeArchived: boolean;
}

/** Catalogue › Kits: the kits the group sells, searched and sorted on the server. */
export function KitsScreen({
  initialPage,
  canWrite,
}: {
  initialPage: KitPageDto;
  canWrite: boolean;
}) {
  const t = useTranslations('catalogue');
  const common = useTranslations('common');
  const [rows, setRows] = useState<KitDto[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [filters, setFilters] = useState<Filters>({ q: '', includeArchived: false });
  const [open, setOpen] = useState<KitDto | undefined>();
  const [adding, setAdding] = useState(false);
  const openButtons = useFocusTargets<string>();
  const addButton = useRef<HTMLButtonElement>(null);
  const { load, pending, failure } = useQuery<KitPageDto>();
  const [loadingMore, setLoadingMore] = useState(false);
  const wanted = useRef<{ filters: Filters; sort: KitSort | undefined }>({
    filters,
    sort: undefined,
  });
  const view = useGridView({
    density: 'compact',
    onSortChange: (next) => {
      readFirstPage(wanted.current.filters, toListSort(next, KIT_SORT_COLUMNS));
    },
  });

  const query = (f: Filters) => ({
    ...(f.q.trim().length === 0 ? {} : { q: f.q.trim() }),
    includeArchived: f.includeArchived,
  });

  function readFirstPage(f: Filters, sort: KitSort | undefined) {
    const asked = { filters: f, sort };
    wanted.current = asked;
    setLoadingMore(false);
    load(
      () => listKits({ limit: PAGE_SIZE, ...query(f), ...sortInput(sort) }),
      (page) => {
        if (wanted.current !== asked) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
      },
    );
  }

  // Typing waits a moment before the list is read again; the tick box reads it at once.
  const typing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(typing.current);
    },
    [],
  );
  function changeFilters(next: Filters, wait: boolean) {
    setFilters(next);
    clearTimeout(typing.current);
    if (!wait) {
      readFirstPage(next, wanted.current.sort);
      return;
    }
    typing.current = setTimeout(() => {
      readFirstPage(next, wanted.current.sort);
    }, 300);
  }

  function loadMore() {
    if (nextCursor === null) return;
    const asked = wanted.current;
    setLoadingMore(true);
    load(
      () =>
        listKits({
          limit: PAGE_SIZE,
          cursor: nextCursor,
          ...query(asked.filters),
          ...sortInput(asked.sort),
        }),
      (page) => {
        if (wanted.current !== asked) return;
        setRows((all) => [...all, ...page.items]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      },
    );
  }

  const columns: DataGridColumn<KitDto>[] = [
    {
      id: 'name',
      header: t('columns.kit'),
      sortable: true,
      primary: true,
      cell: (r) => (
        <Button
          ref={openButtons.ref(r.id)}
          variant="link"
          className="text-left whitespace-normal"
          aria-label={t('openKit', { name: r.name })}
          onClick={() => {
            setOpen(r);
          }}
        >
          {r.name}
        </Button>
      ),
    },
    { id: 'sku', header: t('columns.kitCode'), cell: (r) => r.sku, sortable: true },
    {
      id: 'components',
      header: t('columns.components'),
      align: 'end',
      numeric: true,
      cell: (r) => formatCount(r.componentCount),
    },
    {
      id: 'status',
      header: t('columns.status'),
      cell: (r) => (
        <StatusBadge tone={r.isActive ? 'success' : 'neutral'}>
          {r.isActive ? t('status.active') : t('status.archived')}
        </StatusBadge>
      ),
    },
    {
      id: 'updated',
      header: t('columns.updated'),
      cell: (r) => formatDate(r.updatedAt),
      sortable: true,
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <Field id="kits-search" label={t('search')} className="md:w-72">
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
            checked={filters.includeArchived}
            onChange={(e) => {
              changeFilters({ ...filters, includeArchived: e.currentTarget.checked }, false);
            }}
          />
          {t('showArchivedKits')}
        </label>
        {canWrite ? (
          <Button
            ref={addButton}
            className="md:ml-auto"
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('addKit')}
          </Button>
        ) : null}
      </div>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('kitsCaption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pending && !loadingMore}
        {...view.grid}
        toolbar={
          <ViewsMenu
            screen="catalogue_kits"
            current={view.settings}
            standard={view.standard}
            onApply={view.apply}
          />
        }
        empty={<EmptyState message={t('kitsEmpty')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending: loadingMore }
        }
      />
      {open === undefined ? null : (
        <KitSheet
          kitId={open.id}
          canWrite={canWrite}
          returnFocusTo={() => [openButtons.get(open.id)]}
          onClose={() => {
            setOpen(undefined);
          }}
          onChanged={(kit) => {
            setRows((all) =>
              all.map((r) =>
                r.id === kit.id
                  ? {
                      id: kit.id,
                      sku: kit.sku,
                      name: kit.name,
                      isActive: kit.isActive,
                      componentCount: kit.componentCount,
                      updatedAt: kit.updatedAt,
                    }
                  : r,
              ),
            );
          }}
        />
      )}
      {adding ? (
        <KitFormDialog
          returnFocusTo={() => [addButton.current]}
          onClose={() => {
            setAdding(false);
          }}
          onSaved={(kit) => {
            setAdding(false);
            setRows((all) => [
              {
                id: kit.id,
                sku: kit.sku,
                name: kit.name,
                isActive: kit.isActive,
                componentCount: kit.componentCount,
                updatedAt: kit.updatedAt,
              },
              ...all.filter((r) => r.id !== kit.id),
            ]);
          }}
        />
      ) : null}
    </div>
  );
}
