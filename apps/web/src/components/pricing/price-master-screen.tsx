'use client';

import type {
  KitPricePageDto,
  KitPriceRowDto,
  KitPriceSort,
  PriceListDto,
  PricePageDto,
  PriceRowDto,
  PriceSort,
} from '@shakti/contracts';
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
  useFocusTargets,
  type DataGridColumn,
  type StatusTone,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRef, useState, type SyntheticEvent } from 'react';
import { listKitPrices, listPriceLists, listPrices, setPrice } from '../../actions/pricing';
import { istToday } from '../../screens/audit';
import { KIT_PRICE_SORT_COLUMNS, PRICE_SORT_COLUMNS } from '../../screens/contract-values';
import { formatDate, formatRupees, moneyFromTyped } from '../../screens/format';
import { useCatalogueText } from '../catalogue/use-spec-text';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { sortInput, toListSort } from '../screens/list-sort';
import { useCommand, useQuery } from '../screens/use-command';
import { useGridView } from '../screens/use-grid-view';
import { ViewsMenu } from '../screens/views-menu';

/** The list dialogs and the history sheet, fetched when first opened rather than with the page. */
const NewListDialog = dynamic(() => import('./list-dialogs').then((m) => m.NewListDialog));
const ApproveListDialog = dynamic(() => import('./list-dialogs').then((m) => m.ApproveListDialog));
const PriceHistorySheet = dynamic(() =>
  import('./price-history-sheet').then((m) => m.PriceHistorySheet),
);

const PAGE_SIZE = 50;

const STATE_TONE: Record<PriceListDto['state'], StatusTone> = {
  draft: 'warning',
  scheduled: 'info',
  live: 'success',
  ended: 'neutral',
};

/** What a price is set for: an item or a kit of the catalogue. */
interface Target {
  kind: 'item' | 'kit';
  id: string;
  name: string;
  /** The unit the price is for, in words; a kit is priced as one set. */
  unit: string;
  price: string | null;
}

/**
 * Price Master: pick a price list, read its selling prices of items or kits a page at a time,
 * and, for someone who may set prices, change one price on an open list, start a new version of
 * a list and approve a draft. Each price's history opens in a side sheet. Prices are shown
 * exactly as the list holds them; nothing is worked out on this screen.
 */
export function PriceMasterScreen({
  lists: initialLists,
  companies,
  initialListId,
  initialPage,
  canSetPrices,
  coversAllCompanies,
}: {
  lists: PriceListDto[];
  companies: Record<number, string>;
  initialListId: string | undefined;
  initialPage: PricePageDto | undefined;
  canSetPrices: boolean;
  coversAllCompanies: boolean;
}) {
  const t = useTranslations('priceMaster');
  const common = useTranslations('common');
  const text = useCatalogueText();
  const [lists, setLists] = useState(initialLists);
  const [listId, setListId] = useState(initialListId);
  const [tab, setTab] = useState<'items' | 'kits'>('items');
  const [rows, setRows] = useState<PriceRowDto[]>(initialPage?.items ?? []);
  const [kitRows, setKitRows] = useState<KitPriceRowDto[]>([]);
  const [nextCursor, setNextCursor] = useState(initialPage?.nextCursor ?? null);
  const [pricing, setPricing] = useState<Target | undefined>();
  const [history, setHistory] = useState<Target | undefined>();
  const [listDialog, setListDialog] = useState<'new' | 'approve' | undefined>();
  // Focus goes back to the row's button, in the table or the phone card that shows.
  const setPriceButtons = useFocusTargets<string>();
  const historyButtons = useFocusTargets<string>();
  const newListButton = useRef<HTMLButtonElement>(null);
  const approveButton = useRef<HTMLButtonElement>(null);
  const { load, pending, failure } = useQuery<PricePageDto>();
  const kitQuery = useQuery<KitPricePageDto>();
  const listsQuery = useQuery<PriceListDto[]>();
  const [loadingMore, setLoadingMore] = useState(false);
  // The list, section and order whose prices are wanted: an answer for another is dropped.
  const wanted = useRef<{
    listId: string | undefined;
    tab: 'items' | 'kits';
    sort: PriceSort | undefined;
    kitSort: KitPriceSort | undefined;
  }>({ listId: initialListId, tab: 'items', sort: undefined, kitSort: undefined });
  const view = useGridView({
    density: 'compact',
    onSortChange: (next) => {
      readFirstPage({ ...wanted.current, sort: toListSort(next, PRICE_SORT_COLUMNS) });
    },
  });
  const kitView = useGridView({
    density: 'compact',
    onSortChange: (next) => {
      readFirstPage({ ...wanted.current, kitSort: toListSort(next, KIT_PRICE_SORT_COLUMNS) });
    },
  });

  const list = lists.find((l) => l.id === listId);

  const companyName = (entityId: number | null) =>
    entityId === null ? t('shared') : (companies[entityId] ?? t('shared'));
  const listName = (l: PriceListDto) =>
    t('listOption', { tier: l.tierName, company: companyName(l.entityId), version: l.version });

  /** The first page of a list's items or kits in an order, replacing the rows on screen. */
  function readFirstPage(asked: typeof wanted.current) {
    wanted.current = asked;
    setLoadingMore(false);
    const id = asked.listId;
    if (id === undefined) return;
    if (asked.tab === 'items') {
      setRows([]);
      setNextCursor(null);
      load(
        () => listPrices({ priceListId: id, limit: PAGE_SIZE, ...sortInput(asked.sort) }),
        (page) => {
          if (wanted.current !== asked) return;
          setRows(page.items);
          setNextCursor(page.nextCursor);
        },
      );
    } else {
      setKitRows([]);
      setNextCursor(null);
      kitQuery.load(
        () => listKitPrices({ priceListId: id, limit: PAGE_SIZE, ...sortInput(asked.kitSort) }),
        (page) => {
          if (wanted.current !== asked) return;
          setKitRows(page.items);
          setNextCursor(page.nextCursor);
        },
      );
    }
  }

  function chooseList(id: string) {
    setListId(id);
    readFirstPage({ ...wanted.current, listId: id });
  }

  function chooseTab(next: 'items' | 'kits') {
    if (next === tab) return;
    setTab(next);
    readFirstPage({ ...wanted.current, tab: next });
  }

  function loadMore() {
    if (list === undefined || nextCursor === null) return;
    const asked = wanted.current;
    setLoadingMore(true);
    if (asked.tab === 'items') {
      load(
        () =>
          listPrices({
            priceListId: list.id,
            limit: PAGE_SIZE,
            cursor: nextCursor,
            ...sortInput(asked.sort),
          }),
        (page) => {
          if (wanted.current !== asked) return;
          setRows((all) => [...all, ...page.items]);
          setNextCursor(page.nextCursor);
          setLoadingMore(false);
        },
      );
    } else {
      kitQuery.load(
        () =>
          listKitPrices({
            priceListId: list.id,
            limit: PAGE_SIZE,
            cursor: nextCursor,
            ...sortInput(asked.kitSort),
          }),
        (page) => {
          if (wanted.current !== asked) return;
          setKitRows((all) => [...all, ...page.items]);
          setNextCursor(page.nextCursor);
          setLoadingMore(false);
        },
      );
    }
  }

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      {canSetPrices ? (
        <Button
          ref={newListButton}
          variant="secondary"
          onClick={() => {
            setListDialog('new');
          }}
        >
          {t('newList')}
        </Button>
      ) : null}
      {canSetPrices && list?.state === 'draft' && list.effectiveFrom >= istToday(new Date()) ? (
        <Button
          ref={approveButton}
          onClick={() => {
            setListDialog('approve');
          }}
        >
          {t('approve')}
        </Button>
      ) : null}
    </div>
  );

  const listDialogs = (
    <>
      {listDialog === 'new' ? (
        <NewListDialog
          companies={companies}
          coversAllCompanies={coversAllCompanies}
          returnFocusTo={() => [newListButton.current]}
          onClose={() => {
            setListDialog(undefined);
          }}
          onCreated={(created) => {
            setListDialog(undefined);
            setLists((all) => [created, ...all]);
            chooseList(created.id);
          }}
        />
      ) : null}
      {listDialog === 'approve' && list !== undefined ? (
        <ApproveListDialog
          list={list}
          listName={listName(list)}
          returnFocusTo={() => [approveButton.current, newListButton.current]}
          onClose={() => {
            setListDialog(undefined);
          }}
          onApproved={(approved) => {
            setListDialog(undefined);
            setLists((all) => all.map((l) => (l.id === approved.id ? approved : l)));
            // The list it replaces now ends where this one starts: read the lists again.
            listsQuery.load(listPriceLists, (next) => {
              setLists(next);
            });
          }}
        />
      ) : null}
    </>
  );

  if (list === undefined) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState message={t('noLists')} />
        {listDialogs}
      </div>
    );
  }

  const groups = [
    { key: 'group', label: t('groupLists'), lists: lists.filter((l) => l.entityId === null) },
    ...Object.keys(companies)
      .map(Number)
      .map((entityId) => ({
        key: String(entityId),
        label: t('companyLists', { company: companies[entityId] ?? '' }),
        lists: lists.filter((l) => l.entityId === entityId),
      })),
  ].filter((g) => g.lists.length > 0);

  const canChangeList = canSetPrices && list.open;
  const unitName = (row: PriceRowDto) => t(`unit.${row.unit}`);
  const priceCell = (price: string | null) =>
    price === null ? (
      <span className="text-text-muted">{t('notPriced')}</span>
    ) : (
      formatRupees(price)
    );
  const updatedCell = (updatedAt: string | null) =>
    updatedAt === null ? common('notSet') : formatDate(updatedAt);
  const actionsCell = (target: Target) => (
    <span className="inline-flex flex-wrap justify-end gap-2">
      <Button
        ref={historyButtons.ref(target.id)}
        variant="ghost"
        size="sm"
        aria-label={t('historyFor', { item: target.name })}
        onClick={() => {
          setHistory(target);
        }}
      >
        {t('history')}
      </Button>
      {canChangeList ? (
        <Button
          ref={setPriceButtons.ref(target.id)}
          variant="secondary"
          size="sm"
          aria-label={t('setPriceFor', { item: target.name })}
          onClick={() => {
            setPricing(target);
          }}
        >
          {t('setPrice')}
        </Button>
      ) : null}
    </span>
  );

  // Sorted on the server over the whole list (`PRICE_SORT_COLUMNS`); the unit is not, because
  // its shown name comes from the message catalogue.
  const columns: DataGridColumn<PriceRowDto>[] = [
    { id: 'item', header: t('columns.item'), cell: (r) => r.name, sortable: true, primary: true },
    { id: 'code', header: t('columns.code'), cell: (r) => r.sku, sortable: true },
    {
      id: 'category',
      header: t('columns.category'),
      cell: (r) => text.category(r.category),
      sortable: true,
    },
    { id: 'unit', header: t('columns.unit'), cell: unitName },
    {
      id: 'price',
      header: t('columns.price'),
      align: 'end',
      numeric: true,
      sortable: true,
      cell: (r) => priceCell(r.price),
    },
    {
      id: 'updated',
      header: t('columns.updated'),
      cell: (r) => updatedCell(r.updatedAt),
      sortable: true,
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      align: 'end',
      hideable: false,
      cell: (r) =>
        actionsCell({
          kind: 'item',
          id: r.itemId,
          name: r.name,
          unit: unitName(r),
          price: r.price,
        }),
    },
  ];
  const kitColumns: DataGridColumn<KitPriceRowDto>[] = [
    { id: 'kit', header: t('kitColumns.kit'), cell: (r) => r.name, sortable: true, primary: true },
    { id: 'code', header: t('kitColumns.code'), cell: (r) => r.sku, sortable: true },
    {
      id: 'price',
      header: t('columns.price'),
      align: 'end',
      numeric: true,
      sortable: true,
      cell: (r) => priceCell(r.price),
    },
    {
      id: 'updated',
      header: t('columns.updated'),
      cell: (r) => updatedCell(r.updatedAt),
      sortable: true,
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      align: 'end',
      hideable: false,
      cell: (r) =>
        actionsCell({
          kind: 'kit',
          id: r.kitId,
          name: r.name,
          unit: t('unit.set'),
          price: r.price,
        }),
    },
  ];

  const more =
    nextCursor === null
      ? undefined
      : { label: common('loadMore'), onLoadMore: loadMore, pending: loadingMore };

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
            {groups.map((g) => (
              <optgroup key={g.key} label={g.label}>
                {g.lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {`${listName(l)} · ${t(`state.${l.state}`)}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        {header}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge tone={STATE_TONE[list.state]}>{t(`state.${list.state}`)}</StatusBadge>
        <span className="text-text-muted">
          {list.effectiveTo === null
            ? t('openFrom', { from: formatDate(list.effectiveFrom) })
            : t('openBetween', {
                from: formatDate(list.effectiveFrom),
                to: formatDate(list.effectiveTo),
              })}
        </span>
      </div>
      {list.state === 'draft' ? (
        <p className="text-text-muted">
          {list.effectiveFrom < istToday(new Date()) ? t('draftPassedNote') : t('draftNote')}
        </p>
      ) : null}
      {list.state === 'scheduled' ? (
        <p className="text-text-muted">
          {t('scheduledNote', { from: formatDate(list.effectiveFrom) })}
        </p>
      ) : null}
      {list.open ? null : <p className="text-text-muted">{t('endedNote')}</p>}
      <div role="group" aria-label={t('sections')} className="flex gap-2">
        {(['items', 'kits'] as const).map((section) => (
          <Button
            key={section}
            variant={tab === section ? 'primary' : 'secondary'}
            size="sm"
            aria-pressed={tab === section}
            onClick={() => {
              chooseTab(section);
            }}
          >
            {section === 'items' ? t('itemsTab') : t('kitsTab')}
          </Button>
        ))}
      </div>
      <FailureMessage failure={listsQuery.failure} />
      <FailureMessage failure={tab === 'items' ? failure : kitQuery.failure} />
      {tab === 'items' ? (
        <DataGrid
          caption={t('caption')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.itemId}
          loading={pending && !loadingMore}
          {...view.grid}
          toolbar={
            <ViewsMenu
              screen="price_lists"
              current={view.settings}
              standard={view.standard}
              onApply={view.apply}
            />
          }
          empty={<EmptyState message={t('empty')} />}
          loadMore={more}
        />
      ) : (
        <DataGrid
          caption={t('kitsCaption')}
          columns={kitColumns}
          rows={kitRows}
          rowKey={(r) => r.kitId}
          loading={kitQuery.pending && !loadingMore}
          {...kitView.grid}
          empty={<EmptyState message={t('kitsEmpty')} />}
          loadMore={more}
        />
      )}
      {listDialogs}
      <Dialog
        open={pricing !== undefined}
        onOpenChange={(open) => {
          if (!open) setPricing(undefined);
        }}
      >
        {pricing === undefined ? null : (
          <DialogContent
            closeLabel={common('close')}
            returnFocusTo={() => [setPriceButtons.get(pricing.id)]}
          >
            <SetPriceForm
              target={pricing}
              priceListId={list.id}
              onSaved={(saved) => {
                const change = { price: saved.price, updatedAt: saved.updatedAt };
                if (pricing.kind === 'item') {
                  setRows((all) =>
                    all.map((r) => (r.itemId === pricing.id ? { ...r, ...change } : r)),
                  );
                } else {
                  setKitRows((all) =>
                    all.map((r) => (r.kitId === pricing.id ? { ...r, ...change } : r)),
                  );
                }
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
      {history === undefined ? null : (
        <PriceHistorySheet
          target={history}
          companies={companies}
          returnFocusTo={() => [historyButtons.get(history.id)]}
          onClose={() => {
            setHistory(undefined);
          }}
        />
      )}
    </div>
  );
}

const FIELDS = ['price', 'reason'] as const;

function SetPriceForm({
  target,
  priceListId,
  onSaved,
  onCancel,
}: {
  target: Target;
  priceListId: string;
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
    run(
      {
        priceListId,
        ...(target.kind === 'item' ? { itemId: target.id } : { kitId: target.id }),
        price,
        ...(reason === '' ? {} : { reason }),
      },
      onSaved,
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { item: target.name })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      {target.price === null ? null : (
        <p className="tabular-nums">{t('current', { price: formatRupees(target.price) })}</p>
      )}
      <Field
        id="set-price-amount"
        label={t('price')}
        helper={t('priceHelper', { unit: target.unit })}
        error={typedWrong ? t('priceWrong') : fieldError('price')}
      >
        <Input
          name="price"
          inputMode="decimal"
          autoComplete="off"
          required
          defaultValue={target.price ?? ''}
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
