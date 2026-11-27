'use client';

import type {
  PurchaseOrderPageDto,
  PurchaseOrderRowDto,
  PurchaseOrderState,
} from '@shakti/contracts';
import { Button, cn, DataGrid, EmptyState, StatusBadge, type DataGridColumn } from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { listPurchaseOrders } from '../../actions/purchase-orders';
import { PURCHASE_ORDER_STATES } from '../../screens/contract-values';
import { formatDate } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';

const PAGE_SIZE = 50;

/**
 * Procurement › Orders (docs/03-roadmap-appendix/phase3.md §7.2): one company's purchase orders by
 * state, newest first, with the reorder drafts no person has opened yet on top. No rate or amount
 * is on this list for anyone; the order sheet shows them to a holder of `procurement.rate.read`.
 */
export function OrdersScreen({
  initial,
  entityId,
  state,
  companies,
}: {
  initial: PurchaseOrderPageDto;
  entityId: number;
  state: PurchaseOrderState;
  /** The companies the person may choose between, by id; one needs no choice. */
  companies: Record<number, string>;
}) {
  const t = useTranslations('procurement.orders');
  const states = useTranslations('procurement.orderStates');
  const common = useTranslations('common');
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const { load, pending, failure } = useQuery<PurchaseOrderPageDto>();

  function loadMore() {
    if (nextCursor === null) return;
    load(
      () => listPurchaseOrders({ entityId, state, cursor: nextCursor, limit: PAGE_SIZE }),
      (page) => {
        setRows((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  const href = (next: { company?: number; state?: PurchaseOrderState }) =>
    `/procurement/orders?company=${String(next.company ?? entityId)}&state=${next.state ?? state}` as Route;

  const columns: DataGridColumn<PurchaseOrderRowDto>[] = [
    {
      id: 'poNo',
      header: t('columns.number'),
      primary: true,
      cell: (o) => (
        <Link
          href={`/procurement/orders/${o.id}` as Route}
          className="text-accent-text font-medium underline-offset-4 hover:underline"
        >
          {o.poNo}
        </Link>
      ),
    },
    { id: 'vendor', header: t('columns.vendor'), cell: (o) => o.vendorName },
    { id: 'hub', header: t('columns.hub'), cell: (o) => o.hubName },
    {
      id: 'expected',
      header: t('columns.expected'),
      cell: (o) => (
        <span className="flex items-center gap-2">
          {o.expectedAt === null ? t('noDate') : formatDate(o.expectedAt)}
          {o.overdue ? <StatusBadge tone="danger">{t('overdue')}</StatusBadge> : null}
        </span>
      ),
    },
    {
      id: 'lines',
      header: t('columns.lines'),
      numeric: true,
      align: 'end',
      cell: (o) => o.lineCount,
    },
    {
      id: 'source',
      header: t('columns.source'),
      cell: (o) => (o.source === 'reorder' ? t('fromReorder') : t('byPerson')),
    },
  ];

  const names = Object.entries(companies);
  return (
    <div className="flex flex-col gap-4">
      {names.length > 1 ? (
        <nav aria-label={t('companies')} className="flex flex-wrap gap-2">
          {names.map(([id, name]) => (
            <Button
              key={id}
              asChild
              size="sm"
              variant={Number(id) === entityId ? 'primary' : 'secondary'}
            >
              <Link
                href={href({ company: Number(id), state: 'draft' })}
                aria-current={Number(id) === entityId ? 'page' : undefined}
              >
                {name}
              </Link>
            </Button>
          ))}
        </nav>
      ) : null}

      {initial.reorderAlerts.length === 0 ? null : (
        <section
          aria-labelledby="reorder-alerts"
          className="border-warning/40 bg-warning-soft flex flex-col gap-2 rounded-lg border p-4"
        >
          <h2 id="reorder-alerts" className="text-h3">
            {t('alertsTitle', { count: initial.reorderAlerts.length })}
          </h2>
          <p className="text-text-muted text-sm">{t('alertsIntro')}</p>
          <ul className="flex flex-col gap-1">
            {initial.reorderAlerts.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/procurement/orders/${o.id}` as Route}
                  className="text-accent-text underline-offset-4 hover:underline"
                >
                  {t('alertLine', {
                    number: o.poNo,
                    vendor: o.vendorName,
                    hub: o.hubName,
                    lines: o.lineCount,
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav aria-label={t('states')} className="border-border flex flex-wrap gap-1 border-b">
        {PURCHASE_ORDER_STATES.map((s) => (
          <Link
            key={s}
            href={href({ state: s })}
            aria-current={s === state ? 'page' : undefined}
            className={cn(
              'text-text-muted hover:text-text -mb-px rounded-t-md border-b-2 border-transparent px-3 py-2 font-medium',
              s === state && 'border-accent text-text',
            )}
          >
            {t('stateTab', { state: states(s), count: initial.counts[s] ?? 0 })}
          </Link>
        ))}
      </nav>

      {failure === undefined ? null : <FailureMessage failure={failure} />}
      <DataGrid
        caption={t('caption', { state: states(state) })}
        columns={columns}
        rows={rows}
        rowKey={(o) => o.id}
        empty={<EmptyState message={t('empty', { state: states(state) })} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending }
        }
      />
    </div>
  );
}
