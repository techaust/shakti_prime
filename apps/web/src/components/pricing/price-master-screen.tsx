'use client';

import type { PriceListDto, PricePageDto, PriceRowDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  toast,
  type DataGridColumn,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { listPrices, setPrice } from '../../actions/pricing';
import { formatDate, formatRupees, moneyFromTyped } from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

const PAGE_SIZE = 50;

/**
 * Price Master: pick a price list, read its selling prices a page at a time, and, for someone who
 * may set prices, change one price on an open list. Prices are shown exactly as the list holds
 * them; nothing is worked out on this screen.
 */
export function PriceMasterScreen({
  lists,
  companies,
  initialListId,
  initialPage,
  canSetPrices,
}: {
  lists: PriceListDto[];
  companies: Record<number, string>;
  initialListId: string | undefined;
  initialPage: PricePageDto | undefined;
  canSetPrices: boolean;
}) {
  const t = useTranslations('priceMaster');
  const common = useTranslations('common');
  const [listId, setListId] = useState(initialListId);
  const [rows, setRows] = useState<PriceRowDto[]>(initialPage?.items ?? []);
  const [nextCursor, setNextCursor] = useState(initialPage?.nextCursor ?? null);
  const [pricing, setPricing] = useState<PriceRowDto | undefined>();
  const { load, pending, failure } = useQuery<PricePageDto>();
  const [loadingMore, setLoadingMore] = useState(false);
  // The list whose prices are wanted: an answer for a list chosen before it is dropped.
  const wanted = useRef(initialListId);

  const list = lists.find((l) => l.id === listId);
  if (list === undefined) return <EmptyState message={t('noLists')} />;

  const listName = (l: PriceListDto) =>
    t('listOption', {
      tier: l.tierName,
      company: l.entityId === null ? t('shared') : (companies[l.entityId] ?? t('shared')),
      version: l.version,
    });

  function chooseList(id: string) {
    setListId(id);
    wanted.current = id;
    setRows([]);
    setNextCursor(null);
    setLoadingMore(false);
    load(
      () => listPrices({ priceListId: id, limit: PAGE_SIZE }),
      (page) => {
        if (wanted.current !== id) return;
        setRows(page.items);
        setNextCursor(page.nextCursor);
      },
    );
  }

  function loadMore() {
    if (list === undefined || nextCursor === null) return;
    setLoadingMore(true);
    load(
      () => listPrices({ priceListId: list.id, limit: PAGE_SIZE, cursor: nextCursor }),
      (page) => {
        if (wanted.current !== list.id) return;
        setRows((all) => [...all, ...page.items]);
        setNextCursor(page.nextCursor);
        setLoadingMore(false);
      },
    );
  }

  const unitName = (row: PriceRowDto) => t(`unit.${row.unit}`);
  const columns: DataGridColumn<PriceRowDto>[] = [
    { id: 'item', header: t('columns.item'), cell: (r) => r.name, primary: true },
    { id: 'code', header: t('columns.code'), cell: (r) => r.sku },
    { id: 'category', header: t('columns.category'), cell: (r) => r.category },
    { id: 'unit', header: t('columns.unit'), cell: unitName },
    {
      id: 'price',
      header: t('columns.price'),
      align: 'end',
      numeric: true,
      cell: (r) =>
        r.price === null ? (
          <span className="text-text-muted">{t('notPriced')}</span>
        ) : (
          formatRupees(r.price)
        ),
    },
    {
      id: 'updated',
      header: t('columns.updated'),
      cell: (r) => (r.updatedAt === null ? common('notSet') : formatDate(r.updatedAt)),
    },
  ];
  if (canSetPrices && list.open) {
    columns.push({
      id: 'actions',
      header: t('columns.actions'),
      align: 'end',
      cell: (r) => (
        <Button
          variant="secondary"
          size="sm"
          aria-label={t('setPriceFor', { item: r.name })}
          onClick={() => {
            setPricing(r);
          }}
        >
          {t('setPrice')}
        </Button>
      ),
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <Field id="price-list" label={t('list')} className="md:max-w-md md:flex-1">
          <Select
            value={list.id}
            onChange={(e) => {
              chooseList(e.currentTarget.value);
            }}
          >
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {listName(l)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone={list.open ? 'success' : 'neutral'}>
            {list.open ? t('open') : t('ended')}
          </StatusBadge>
          <span className="text-text-muted">
            {list.effectiveTo === null
              ? t('openFrom', { from: formatDate(list.effectiveFrom) })
              : t('openBetween', {
                  from: formatDate(list.effectiveFrom),
                  to: formatDate(list.effectiveTo),
                })}
          </span>
        </div>
      </div>
      {list.open ? null : <p className="text-text-muted">{t('endedNote')}</p>}
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.itemId}
        loading={pending && !loadingMore}
        density="compact"
        empty={<EmptyState message={t('empty')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending: loadingMore }
        }
      />
      <Dialog
        open={pricing !== undefined}
        onOpenChange={(open) => {
          if (!open) setPricing(undefined);
        }}
      >
        {pricing === undefined ? null : (
          <DialogContent closeLabel={common('close')}>
            <SetPriceForm
              row={pricing}
              priceListId={list.id}
              unit={unitName(pricing)}
              onSaved={(saved) => {
                setRows((all) =>
                  all.map((r) =>
                    r.itemId === pricing.itemId
                      ? { ...r, price: saved.price, updatedAt: saved.updatedAt }
                      : r,
                  ),
                );
                setPricing(undefined);
                toast.success(t('dialog.done', { item: pricing.name }));
              }}
              onCancel={() => {
                setPricing(undefined);
              }}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

const FIELDS = ['price', 'reason'] as const;

function SetPriceForm({
  row,
  priceListId,
  unit,
  onSaved,
  onCancel,
}: {
  row: PriceRowDto;
  priceListId: string;
  unit: string;
  onSaved: (saved: { price: string; updatedAt: string }) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('priceMaster.dialog');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setPrice);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [typedWrong, setTypedWrong] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const price = moneyFromTyped(formText(data, 'price'));
    setTypedWrong(price === undefined);
    if (price === undefined) return;
    const reason = formText(data, 'reason');
    run({ priceListId, itemId: row.itemId, price, ...(reason === '' ? {} : { reason }) }, onSaved);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { item: row.name })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      {row.price === null ? null : (
        <p className="tabular-nums">{t('current', { price: formatRupees(row.price) })}</p>
      )}
      <Field
        id="set-price-amount"
        label={t('price')}
        helper={t('priceHelper', { unit })}
        error={typedWrong ? t('priceWrong') : fieldError('price')}
      >
        <Input
          name="price"
          inputMode="decimal"
          autoComplete="off"
          required
          defaultValue={row.price ?? ''}
          className="tabular-nums"
        />
      </Field>
      <Field
        id="set-price-reason"
        label={t('reason')}
        helper={t('reasonHelper')}
        error={fieldError('reason')}
      >
        <Input name="reason" maxLength={200} autoComplete="off" />
      </Field>
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
