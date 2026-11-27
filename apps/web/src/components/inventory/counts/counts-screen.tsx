'use client';

import type {
  HubDto,
  ItemDto,
  StockCountPageDto,
  StockCountRowDto,
  StockCountScope,
  StockCountState,
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
  Select,
  StatusBadge,
  toast,
  type DataGridColumn,
  type ReturnFocusTo,
} from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type SyntheticEvent } from 'react';
import { listStockCounts, startStockCount } from '../../../actions/stock-counts';
import { STOCK_COUNT_SCOPES, STOCK_COUNT_STATES } from '../../../screens/contract-values';
import { formatDateTime } from '../../../screens/format';
import { countHref, countReviewHref, countStateTone } from '../../../screens/stock-counts';
import { FailureMessage, useFieldFailure } from '../../screens/failure';
import { formText } from '../../screens/form-data';
import { useCommand, useQuery } from '../../screens/use-command';
import { useBinKindText } from '../use-inventory-text';
import { ItemFinder } from './item-finder';

const PAGE_SIZE = 50;

/**
 * `/inventory/counts`: one company's stock counts, newest first, by status; a counter opens a live
 * count to count it, the Inventory Manager starts counts and opens their review.
 */
export function CountsScreen({
  initial,
  entityId,
  state,
  companies,
  canCount,
  canReview,
  hubs,
}: {
  initial: StockCountPageDto;
  entityId: number;
  state: StockCountState | undefined;
  companies: Record<number, string>;
  canCount: boolean;
  canReview: boolean;
  /** The godowns and factories in use, with their bins in use; empty for a counter. */
  hubs: readonly HubDto[];
}) {
  const t = useTranslations('inventory.counts');
  const router = useRouter();
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [starting, setStarting] = useState(false);
  const startButton = useRef<HTMLButtonElement>(null);
  const { load, pending, failure } = useQuery<StockCountPageDto>();
  const ids = Object.keys(companies).map(Number);

  function apply(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const query = new URLSearchParams({ company: formText(data, 'company') || String(entityId) });
    const chosen = formText(data, 'state');
    if (chosen !== '') query.set('state', chosen);
    router.push(`/inventory/counts?${query.toString()}` as Route);
  }

  function more() {
    if (nextCursor === null) return;
    load(
      () =>
        listStockCounts({
          entityId,
          limit: PAGE_SIZE,
          cursor: nextCursor,
          ...(state === undefined ? {} : { state }),
        }),
      (page) => {
        setRows((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  const live = (r: StockCountRowDto) => r.state === 'open' || r.state === 'counting';
  const columns: DataGridColumn<StockCountRowDto>[] = [
    {
      id: 'hub',
      header: t('columns.hub'),
      primary: true,
      cell: (r) => `${r.hubName} (${r.hubCode})`,
    },
    {
      id: 'scope',
      header: t('columns.scope'),
      cell: (r) =>
        r.scope === 'hub'
          ? t('scopes.hub')
          : t(`scopes.${r.scope}`, { count: (r.scope === 'bins' ? r.binIds : r.itemIds)?.length ?? 0 }),
    },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (r) => <StatusBadge tone={countStateTone(r.state)}>{t(`states.${r.state}`)}</StatusBadge>,
    },
    { id: 'started', header: t('columns.started'), cell: (r) => formatDateTime(r.startedAt) },
    { id: 'startedBy', header: t('columns.startedBy'), cell: (r) => r.startedByName },
    {
      id: 'open',
      header: t('columns.open'),
      cell: (r) => (
        <span className="flex flex-wrap gap-3">
          {canCount && live(r) ? (
            <Link
              className="text-accent-text underline-offset-4 hover:underline"
              href={countHref(r.entityId, r.id)}
              aria-label={`${t('openCount')}: ${t('openFor', { hub: r.hubName })}`}
            >
              {t('openCount')}
            </Link>
          ) : null}
          {canReview && r.state !== 'open' ? (
            <Link
              className="text-accent-text underline-offset-4 hover:underline"
              href={countReviewHref(r.entityId, r.id)}
              aria-label={`${t('openReview')}: ${t('openFor', { hub: r.hubName })}`}
            >
              {t('openReview')}
            </Link>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {canReview ? (
        <div>
          <Button
            ref={startButton}
            onClick={() => {
              setStarting(true);
            }}
          >
            {t('start.open')}
          </Button>
        </div>
      ) : null}
      <form onSubmit={apply} className="flex flex-col gap-3" aria-label={t('filters')}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ids.length > 1 ? (
            <Field id="counts-company" label={t('company')}>
              <Select name="company" defaultValue={String(entityId)}>
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {companies[id]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field id="counts-state" label={t('state')}>
            <Select name="state" defaultValue={state ?? ''}>
              <option value="">{t('allStates')}</option>
              {STOCK_COUNT_STATES.map((s) => (
                <option key={s} value={s}>
                  {t(`states.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <Button type="submit" variant="secondary">
            {t('apply')}
          </Button>
        </div>
      </form>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState message={t('empty')} />}
        loadMore={
          nextCursor === null ? undefined : { label: t('loadMore'), onLoadMore: more, pending }
        }
      />
      {starting ? (
        <StartDialog
          entityId={entityId}
          companies={companies}
          hubs={hubs}
          returnFocusTo={startButton}
          onClose={() => {
            setStarting(false);
          }}
          onStarted={(countId, company) => {
            setStarting(false);
            router.push(countHref(company, countId));
          }}
        />
      ) : null}
    </div>
  );
}

/** Start a count: the company, the hub, and the whole hub, chosen bins or chosen items. */
function StartDialog({
  entityId,
  companies,
  hubs,
  returnFocusTo,
  onClose,
  onStarted,
}: {
  entityId: number;
  companies: Record<number, string>;
  hubs: readonly HubDto[];
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onStarted: (countId: string, entityId: number) => void;
}) {
  const t = useTranslations('inventory.counts.start');
  const finder = useTranslations('inventory.counts.findItem');
  const common = useTranslations('common');
  const binKind = useBinKindText();
  const { run, pending, failure } = useCommand(startStockCount);
  const { formFailure } = useFieldFailure(failure, []);
  const [hubId, setHubId] = useState(hubs[0]?.id ?? '');
  const [scope, setScope] = useState<StockCountScope>('hub');
  const [items, setItems] = useState<ItemDto[]>([]);
  const [problem, setProblem] = useState<'bins' | 'items' | undefined>();
  const hub = hubs.find((h) => h.id === hubId);
  const ids = Object.keys(companies).map(Number);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || hub === undefined) return;
    const data = new FormData(e.currentTarget);
    const company = Number(formText(data, 'company') || entityId);
    const binIds = data.getAll('bins').filter((v): v is string => typeof v === 'string');
    if (scope === 'bins' && binIds.length === 0) {
      setProblem('bins');
      return;
    }
    if (scope === 'items' && items.length === 0) {
      setProblem('items');
      return;
    }
    setProblem(undefined);
    run(
      {
        entityId: company,
        hubId: hub.id,
        scope,
        ...(scope === 'bins' ? { binIds } : {}),
        ...(scope === 'items' ? { itemIds: items.map((i) => i.id) } : {}),
      },
      (count) => {
        toast.success(t('started'));
        onStarted(count.id, count.entityId);
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          {hubs.length === 0 ? (
            <p role="status">{t('noHubs')}</p>
          ) : (
            <>
              {ids.length > 1 ? (
                <Field id="count-start-company" label={t('company')}>
                  <Select name="company" defaultValue={String(entityId)}>
                    {ids.map((id) => (
                      <option key={id} value={id}>
                        {companies[id]}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}
              <Field id="count-start-hub" label={t('hub')}>
                <Select
                  value={hubId}
                  onChange={(e) => {
                    setHubId(e.currentTarget.value);
                  }}
                >
                  {hubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{t('scope')}</legend>
                {STOCK_COUNT_SCOPES.map((s) => (
                  <label key={s} className="flex min-h-control items-center gap-2">
                    <input
                      type="radio"
                      name="scope"
                      value={s}
                      checked={scope === s}
                      onChange={() => {
                        setScope(s);
                        setProblem(undefined);
                      }}
                    />
                    {s === 'hub' ? t('scopeHub') : s === 'bins' ? t('scopeBins') : t('scopeItems')}
                  </label>
                ))}
              </fieldset>
              {scope === 'bins' && hub !== undefined ? (
                <fieldset
                  key={hub.id}
                  className="flex flex-col gap-1"
                  aria-describedby={problem === 'bins' ? 'count-start-bins-error' : undefined}
                >
                  <legend className="mb-1 text-sm font-medium">{t('bins')}</legend>
                  {hub.bins.map((b) => (
                    <label key={b.id} className="flex min-h-control items-center gap-2">
                      <input type="checkbox" name="bins" value={b.id} />
                      {`${b.code} (${binKind(b.kind)})`}
                    </label>
                  ))}
                  {problem === 'bins' ? (
                    <p id="count-start-bins-error" className="text-danger text-sm">
                      {t('binsMissing')}
                    </p>
                  ) : null}
                </fieldset>
              ) : null}
              {scope === 'items' ? (
                <div className="flex flex-col gap-2">
                  <ItemFinder
                    id="count-start-find"
                    chooseLabel={(item) => finder('addItem', { name: item.name })}
                    onChoose={(item) => {
                      setItems((current) =>
                        current.some((i) => i.id === item.id) ? current : [...current, item],
                      );
                      setProblem(undefined);
                    }}
                  />
                  {items.length === 0 ? null : (
                    <ul aria-label={finder('chosen')} className="flex flex-col gap-1">
                      {items.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3">
                          <span>{`${item.name} (${item.sku})`}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={finder('removeItem', { name: item.name })}
                            onClick={() => {
                              setItems((current) => current.filter((i) => i.id !== item.id));
                            }}
                          >
                            {finder('remove')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {problem === 'items' ? (
                    <p className="text-danger text-sm" role="alert">
                      {t('itemsMissing')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            {hubs.length === 0 ? null : (
              <Button type="submit" pending={pending}>
                {t('submit')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
