'use client';

import type { ItemCategory, ItemDto, ItemPageDto, ItemSort } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  useFocusTargets,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { listItems } from '../../actions/catalogue';
import { ITEM_CATEGORIES, ITEM_SORT_COLUMNS } from '../../screens/contract-values';
import { formatDate } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { sortInput, toListSort } from '../screens/list-sort';
import { useQuery } from '../screens/use-command';
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu } from '../screens/views-menu';
import { useCatalogueText } from './use-spec-text';

/** The item sheet and the item form, fetched when first opened rather than with the page. */
const ItemSheet = dynamic(() => import('./item-sheet').then((m) => m.ItemSheet));
const ItemFormDialog = dynamic(() => import('./item-form').then((m) => m.ItemFormDialog));

const PAGE_SIZE = 50;

interface Filters {
  q: string;
  category: ItemCategory | '';
  includeArchived: boolean;
}

/**
 * Catalogue › Items: the shared catalogue a page at a time, searched, filtered and sorted on the
 * server. A row opens the item sheet; someone with `catalogue.write` adds and changes items.
 */
export function ItemsScreen({
  initialPage,
  canWrite,
}: {
  initialPage: ItemPageDto;
  canWrite: boolean;
}) {
  const t = useTranslations('catalogue');
  const common = useTranslations('common');
  const text = useCatalogueText();
  const [rows, setRows] = useState<ItemDto[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [filters, setFilters] = useState<Filters>({ q: '', category: '', includeArchived: false });
  const [open, setOpen] = useState<ItemDto | undefined>();
  const [adding, setAdding] = useState(false);
  const openButtons = useFocusTargets<string>();
  const addButton = useRef<HTMLButtonElement>(null);
  const { load, pending, failure } = useQuery<ItemPageDto>();
  const [loadingMore, setLoadingMore] = useState(false);
  // The filters and order whose rows are wanted: an answer for earlier ones is dropped.
  const wanted = useRef<{ filters: Filters; sort: ItemSort | undefined }>({
    filters,
    sort: undefined,
  });
  const view = useGridView({
    density: 'compact',
    onSortChange: (next) => {
      readFirstPage(wanted.current.filters, toListSort(next, ITEM_SORT_COLUMNS));
    },
  });

  function query(f: Filters) {
    return {
      ...(f.q.trim().length === 0 ? {} : { q: f.q.trim() }),
      ...(f.category === '' ? {} : { category: f.category }),
      includeArchived: f.includeArchived,
    };
  }

  function readFirstPage(f: Filters, sort: ItemSort | undefined) {
    const asked = { filters: f, sort };
    wanted.current = asked;
    setLoadingMore(false);
    load(
      () => listItems({ limit: PAGE_SIZE, ...query(f), ...sortInput(sort) }),
      (page) => {
        if (wanted.current !== asked) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
      },
    );
  }

  // Typing waits a moment before the list is read again; a choice reads it at once.
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
        listItems({
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

  const columns: DataGridColumn<ItemDto>[] = [
    {
      id: 'name',
      header: t('columns.name'),
      sortable: true,
      primary: true,
      cell: (r) => (
        <Button
          ref={openButtons.ref(r.id)}
          variant="link"
          className="text-left whitespace-normal"
          aria-label={t('openItem', { name: r.name })}
          onClick={() => {
            setOpen(r);
          }}
        >
          {r.name}
        </Button>
      ),
    },
    { id: 'sku', header: t('columns.sku'), cell: (r) => r.sku, sortable: true },
    {
      id: 'category',
      header: t('columns.category'),
      cell: (r) => text.category(r.category),
      sortable: true,
    },
    { id: 'hsn', header: t('columns.hsn'), cell: (r) => r.hsn, sortable: true, numeric: true },
    { id: 'unit', header: t('columns.unit'), cell: (r) => text.unit(r.unit) },
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
        <Field id="catalogue-search" label={t('search')} className="md:w-72">
          <Input
            type="search"
            autoComplete="off"
            value={filters.q}
            onChange={(e) => {
              changeFilters({ ...filters, q: e.currentTarget.value }, true);
            }}
          />
        </Field>
        <Field id="catalogue-category" label={t('category')} className="md:w-56">
          <Select
            value={filters.category}
            onChange={(e) => {
              const category = e.currentTarget.value as ItemCategory | '';
              changeFilters({ ...filters, category }, false);
            }}
          >
            <option value="">{t('allCategories')}</option>
            {ITEM_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {text.category(c)}
              </option>
            ))}
          </Select>
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
          {t('showArchivedItems')}
        </label>
        {canWrite ? (
          <Button
            ref={addButton}
            className="md:ml-auto"
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('addItem')}
          </Button>
        ) : null}
      </div>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('itemsCaption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pending && !loadingMore}
        {...view.grid}
        toolbar={
          <ViewsMenu
            screen="catalogue_items"
            current={view.settings}
            standard={view.standard}
            onApply={view.apply}
          />
        }
        empty={<EmptyState message={t('itemsEmpty')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending: loadingMore }
        }
      />
      {open === undefined ? null : (
        <ItemSheet
          itemId={open.id}
          canWrite={canWrite}
          returnFocusTo={() => [openButtons.get(open.id)]}
          onClose={() => {
            setOpen(undefined);
          }}
          onChanged={(item) => {
            setRows((all) => all.map((r) => (r.id === item.id ? { ...r, ...item } : r)));
          }}
        />
      )}
      {adding ? (
        <ItemFormDialog
          returnFocusTo={() => [addButton.current]}
          onClose={() => {
            setAdding(false);
          }}
          onSaved={(item) => {
            setAdding(false);
            setRows((all) => [item, ...all.filter((r) => r.id !== item.id)]);
          }}
        />
      ) : null}
    </div>
  );
}
