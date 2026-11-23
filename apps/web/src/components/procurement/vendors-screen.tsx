'use client';

import type { VendorDto, VendorListPageDto, VendorListRowDto } from '@shakti/contracts';
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
import { listVendors } from '../../actions/procurement';
import { formatCount } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import type { QuoteCompany } from './quote-form';

/** The vendor sheet and the vendor form, fetched when first opened rather than with the page. */
const VendorSheet = dynamic(() => import('./vendor-sheet').then((m) => m.VendorSheet));
const VendorFormDialog = dynamic(() => import('./vendor-form').then((m) => m.VendorFormDialog));

const PAGE_SIZE = 50;

interface Filters {
  q: string;
  includeArchived: boolean;
}

/** What the person may do on the vendor screens, worked out on the server from their grants. */
export interface VendorPowers {
  /** `procurement.po.write`: add and change vendors, their people and items. */
  canWrite: boolean;
  /** `procurement.rate.read` with `procurement.po.write`: record and withdraw quotes. */
  canRecordQuotes: boolean;
  /** The companies a quote may be recorded for, the group first when the request covers it. */
  quoteCompanies: readonly QuoteCompany[];
}

/**
 * Procurement › Vendors: the group's vendor list a page at a time, by name, searched on the
 * server. A row opens the vendor sheet; a holder of `procurement.po.write` adds vendors. No rate
 * is on this screen: the sheet shows quotes only to a holder of `procurement.rate.read`, whose
 * answer alone carries them.
 */
export function VendorsScreen({
  initialPage,
  powers,
  uploadLimit,
}: {
  initialPage: VendorListPageDto;
  powers: VendorPowers;
  uploadLimit: { contentTypes: readonly string[]; maxBytes: number };
}) {
  const t = useTranslations('procurement');
  const common = useTranslations('common');
  const [rows, setRows] = useState<VendorListRowDto[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [filters, setFilters] = useState<Filters>({ q: '', includeArchived: false });
  const [open, setOpen] = useState<string | undefined>();
  const [adding, setAdding] = useState(false);
  const openButtons = useFocusTargets<string>();
  const addButton = useRef<HTMLButtonElement>(null);
  const { load, pending, failure } = useQuery<VendorListPageDto>();
  const [loadingMore, setLoadingMore] = useState(false);
  const wanted = useRef<Filters>(filters);

  function query(f: Filters) {
    return {
      ...(f.q.trim().length === 0 ? {} : { q: f.q.trim() }),
      includeArchived: f.includeArchived,
    };
  }

  function readFirstPage(f: Filters) {
    wanted.current = f;
    setLoadingMore(false);
    load(
      () => listVendors({ limit: PAGE_SIZE, ...query(f) }),
      (page) => {
        if (wanted.current !== f) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
      },
    );
  }

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
      () => listVendors({ limit: PAGE_SIZE, cursor: nextCursor, ...query(asked) }),
      (page) => {
        if (wanted.current !== asked) return;
        setRows((all) => [...all, ...page.items]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      },
    );
  }

  /** The list row of a vendor the sheet or the form changed, without reading the list again. */
  function rowOf(vendor: VendorDto, itemCount: number): VendorListRowDto {
    return {
      id: vendor.id,
      name: vendor.name,
      gstin: vendor.gstin,
      stateCode: vendor.stateCode,
      city: vendor.address.city ?? null,
      paymentTermsDays: vendor.paymentTermsDays,
      leadTimeDays: vendor.leadTimeDays,
      isActive: vendor.isActive,
      itemCount,
    };
  }

  const days = (n: number | null) => (n === null ? t('notRecorded') : t('days', { count: n }));

  const columns: DataGridColumn<VendorListRowDto>[] = [
    {
      id: 'name',
      header: t('columns.vendor'),
      primary: true,
      cell: (r) => (
        <Button
          ref={openButtons.ref(r.id)}
          variant="link"
          className="text-left whitespace-normal"
          aria-label={t('openVendor', { name: r.name })}
          onClick={() => {
            setOpen(r.id);
          }}
        >
          {r.name}
        </Button>
      ),
    },
    { id: 'gstin', header: t('columns.gstin'), cell: (r) => r.gstin ?? t('notRecorded') },
    { id: 'city', header: t('columns.city'), cell: (r) => r.city ?? t('notRecorded') },
    { id: 'terms', header: t('columns.terms'), cell: (r) => days(r.paymentTermsDays) },
    { id: 'leadTime', header: t('columns.leadTime'), cell: (r) => days(r.leadTimeDays) },
    {
      id: 'items',
      header: t('columns.items'),
      numeric: true,
      cell: (r) => formatCount(r.itemCount),
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
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
        <Field
          id="vendor-search"
          label={t('search')}
          helper={t('searchHelper')}
          className="md:w-72"
        >
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
          {t('showArchived')}
        </label>
        {powers.canWrite ? (
          <Button
            ref={addButton}
            className="md:ml-auto"
            onClick={() => {
              setAdding(true);
            }}
          >
            {t('addVendor')}
          </Button>
        ) : null}
      </div>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('vendorsCaption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={pending && !loadingMore}
        empty={<EmptyState message={filters.q === '' ? t('vendorsEmpty') : t('vendorsNoMatch')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending: loadingMore }
        }
      />
      {open === undefined ? null : (
        <VendorSheet
          vendorId={open}
          powers={powers}
          uploadLimit={uploadLimit}
          returnFocusTo={() => [openButtons.get(open)]}
          onClose={() => {
            setOpen(undefined);
          }}
          onChanged={(vendor, itemCount) => {
            setRows((all) => all.map((r) => (r.id === vendor.id ? rowOf(vendor, itemCount) : r)));
          }}
        />
      )}
      {adding ? (
        <VendorFormDialog
          returnFocusTo={() => [addButton.current]}
          onClose={() => {
            setAdding(false);
          }}
          onSaved={(vendor) => {
            setAdding(false);
            setRows((all) => [rowOf(vendor, 0), ...all.filter((r) => r.id !== vendor.id)]);
            setOpen(vendor.id);
          }}
        />
      ) : null}
    </div>
  );
}
