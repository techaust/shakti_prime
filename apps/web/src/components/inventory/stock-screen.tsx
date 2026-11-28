'use client';

import type { HubDto, StockBalancePageDto, StockBalanceRowDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  Field,
  Input,
  Select,
  type DataGridColumn,
} from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { listStockBalances } from '../../actions/inventory';
import { ITEM_CATEGORIES } from '../../screens/contract-values';
import { formatQty, stockCardHref } from '../../screens/inventory';
import { useCatalogueText } from '../catalogue/use-spec-text';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useQuery } from '../screens/use-command';
import { useBinKindText } from './use-inventory-text';

const PAGE_SIZE = 50;

export interface StockFilters {
  hubId?: string | undefined;
  category?: string | undefined;
  search?: string | undefined;
}

/**
 * `/inventory/stock` (docs/03-roadmap-appendix/phase3.md §6.2, `inventory.stock.read`): one
 * company's stock by hub, bin and item, with what is on hand, reserved and free (free stock is
 * what storage bins hold beyond their reservations), filtered by hub, category or the item's
 * code or name; each item opens its stock card.
 */
export function StockScreen({
  initial,
  entityId,
  companies,
  hubs,
  filters,
}: {
  initial: StockBalancePageDto;
  entityId: number;
  /** The companies the caller may choose between, by id. */
  companies: Record<number, string>;
  hubs: readonly HubDto[];
  filters: StockFilters;
}) {
  const t = useTranslations('inventory.stock');
  const common = useTranslations('common');
  const catalogue = useCatalogueText();
  const binKind = useBinKindText();
  const router = useRouter();
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const { load, pending, failure } = useQuery<StockBalancePageDto>();

  function go(company: number, next: StockFilters) {
    const query = new URLSearchParams({ company: String(company) });
    if (next.hubId) query.set('hub', next.hubId);
    if (next.category) query.set('category', next.category);
    if (next.search) query.set('q', next.search);
    router.push(`/inventory/stock?${query.toString()}` as Route);
  }

  function apply(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    go(Number(formText(data, 'company') || entityId), {
      hubId: formText(data, 'hub') || undefined,
      category: formText(data, 'category') || undefined,
      search: formText(data, 'q') || undefined,
    });
  }

  const quantity = (r: StockBalanceRowDto, qty: string) => catalogue.quantity(r.unit, Number(qty));

  const columns: DataGridColumn<StockBalanceRowDto>[] = [
    {
      id: 'item',
      header: t('columns.item'),
      primary: true,
      cell: (r) => (
        <span className="flex flex-col">
          <Link
            href={stockCardHref(entityId, r.itemId)}
            className="text-accent-text hover:underline"
          >
            {r.itemName}
          </Link>
          <span className="text-text-muted text-xs">{r.sku}</span>
        </span>
      ),
    },
    {
      id: 'category',
      header: t('columns.category'),
      cell: (r) => catalogue.category(r.category),
    },
    { id: 'hub', header: t('columns.hub'), cell: (r) => r.hubName },
    {
      id: 'bin',
      header: t('columns.bin'),
      cell: (r) => (
        <span className="flex flex-col">
          <span>{r.binCode}</span>
          <span className="text-text-muted text-xs">{binKind(r.binKind)}</span>
        </span>
      ),
    },
    {
      id: 'onHand',
      header: t('columns.onHand'),
      numeric: true,
      cell: (r) => quantity(r, r.onHand),
    },
    {
      id: 'reserved',
      header: t('columns.reserved'),
      numeric: true,
      cell: (r) => formatQty(r.reserved),
    },
    {
      id: 'free',
      header: t('columns.free'),
      numeric: true,
      cell: (r) => (r.free === null ? t('notFree') : formatQty(r.free)),
    },
  ];

  const ids = Object.keys(companies).map(Number);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form onSubmit={apply} className="flex flex-col gap-3" aria-label={t('filters.label')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ids.length > 1 ? (
            <Field id="stock-company" label={t('filters.company')}>
              <Select name="company" defaultValue={String(entityId)}>
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {companies[id]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field id="stock-hub" label={t('filters.hub')}>
            <Select name="hub" defaultValue={filters.hubId ?? ''}>
              <option value="">{t('filters.anyHub')}</option>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="stock-category" label={t('filters.category')}>
            <Select name="category" defaultValue={filters.category ?? ''}>
              <option value="">{t('filters.anyCategory')}</option>
              {ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {catalogue.category(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="stock-search" label={t('filters.search')} helper={t('filters.searchHelper')}>
            <Input name="q" maxLength={80} autoComplete="off" defaultValue={filters.search ?? ''} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit">{t('filters.apply')}</Button>
          <Button
            variant="secondary"
            onClick={() => {
              go(entityId, {});
            }}
          >
            {t('filters.clearFilters')}
          </Button>
        </div>
      </form>
      <FailureMessage failure={failure} />
      {initial.hiddenByCount ? (
        <p role="status" className="text-text-muted text-sm">
          {t('countingHidden')}
        </p>
      ) : null}
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => `${r.binId}/${r.itemId}`}
        loading={pending && rows.length === 0}
        empty={<EmptyState message={t('empty')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : {
                label: common('loadMore'),
                onLoadMore: () => {
                  load(
                    () =>
                      listStockBalances({
                        entityId,
                        limit: PAGE_SIZE,
                        cursor: nextCursor,
                        ...(filters.hubId ? { hubId: filters.hubId } : {}),
                        ...(filters.category ? { category: filters.category } : {}),
                        ...(filters.search ? { search: filters.search } : {}),
                      }),
                    (page) => {
                      setRows((all) => [...all, ...page.items]);
                      setNextCursor(page.nextCursor);
                    },
                  );
                },
                pending,
              }
        }
      />
    </div>
  );
}
