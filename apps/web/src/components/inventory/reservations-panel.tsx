'use client';

import type {
  BackorderListDto,
  BackorderRowDto,
  ExtendAuthority,
  HubDto,
  ReservationListDto,
  ReservationRowDto,
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
  Textarea,
  toast,
  type DataGridColumn,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type SyntheticEvent } from 'react';
import {
  extendReservation,
  listReservations,
  moveReservation,
  releaseReservation,
} from '../../actions/reservations';
import { formatDate, formatDateTime } from '../../screens/format';
import { orderHref } from '../../screens/orders';
import { plainQuantity } from '../../screens/quotes';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

type Change = 'extend' | 'release' | 'move';

interface Open {
  change: Change;
  row: ReservationRowDto;
  returnFocusTo: ReturnFocusTo;
}

/** A reason a person gives: 3 to 300 characters, as the commands take it. */
function reasonProblem(reason: string): boolean {
  return reason.length < 3 || reason.length > 300;
}

/**
 * The stock held for an order, or for orders of one item (H2, docs/03-roadmap-appendix/phase3.md
 * §7.1), soonest to end first, with Extend (once; the Inventory Manager or the General Manager),
 * Release and Move (the Inventory Manager) for whoever holds the grant. Shown only to a holder of
 * `inventory.stock.read`, whose read it is.
 */
export function ReservationsPanel({
  entityId,
  scope,
  initial,
  hubs,
  extendAuthority,
  canAdjust,
}: {
  entityId: number;
  scope: { orderId: string } | { itemId: string };
  initial: ReservationListDto;
  hubs: readonly HubDto[];
  /** The grant the viewer extends with, or null when they may not. */
  extendAuthority: ExtendAuthority | null;
  canAdjust: boolean;
}) {
  const t = useTranslations('inventory.reservations');
  const [list, setList] = useState(initial);
  const [open, setOpen] = useState<Open | undefined>();
  const { load, failure } = useQuery<ReservationListDto>();
  const byOrder = 'orderId' in scope;

  function reload() {
    load(() => listReservations({ entityId, ...scope }), setList);
  }

  function ask(change: Change, row: ReservationRowDto, button: HTMLButtonElement) {
    setOpen({ change, row, returnFocusTo: () => [button] });
  }

  const columns: DataGridColumn<ReservationRowDto>[] = [
    byOrder
      ? {
          id: 'item',
          header: t('columns.item'),
          primary: true,
          cell: (r) => (
            <span className="flex flex-col">
              <span className="break-words">{r.itemName}</span>
              <span className="text-text-muted text-xs">
                {r.linePosition === null
                  ? r.sku
                  : `${r.sku} · ${t('line', { position: r.linePosition })}`}
              </span>
            </span>
          ),
        }
      : {
          id: 'order',
          header: t('columns.order'),
          primary: true,
          cell: (r) =>
            r.soNo === null ? (
              <span className="text-text-muted">{t('orderHidden')}</span>
            ) : (
              <Link
                href={orderHref(r.entityId, r.orderId)}
                className="text-accent-text tabular-nums hover:underline"
              >
                {r.soNo}
              </Link>
            ),
        },
    { id: 'where', header: t('columns.where'), cell: (r) => `${r.hubName} · ${r.binCode}` },
    {
      id: 'quantity',
      header: t('columns.quantity'),
      numeric: true,
      cell: (r) => plainQuantity(r.qty),
    },
    {
      id: 'until',
      header: t('columns.until'),
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <time dateTime={r.expiresAt}>{formatDate(r.expiresAt)}</time>
          {r.extended ? <StatusBadge tone="neutral">{t('extended')}</StatusBadge> : null}
        </span>
      ),
    },
  ];
  if (extendAuthority !== null || canAdjust) {
    columns.push({
      id: 'actions',
      header: t('columns.actions'),
      cell: (r) => (
        <span className="flex flex-wrap gap-2">
          {extendAuthority !== null && !r.extended ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label={t('extendLabel', { item: r.itemName })}
              onClick={(e) => {
                ask('extend', r, e.currentTarget);
              }}
            >
              {t('extend')}
            </Button>
          ) : null}
          {canAdjust ? (
            <>
              <Button
                size="sm"
                variant="secondary"
                aria-label={t('moveLabel', { item: r.itemName })}
                onClick={(e) => {
                  ask('move', r, e.currentTarget);
                }}
              >
                {t('move')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                aria-label={t('releaseLabel', { item: r.itemName })}
                onClick={(e) => {
                  ask('release', r, e.currentTarget);
                }}
              >
                {t('release')}
              </Button>
            </>
          ) : null}
        </span>
      ),
    });
  }

  const done = (message: string) => {
    setOpen(undefined);
    toast.success(message);
    reload();
  };

  return (
    <section className="flex flex-col gap-2" aria-labelledby="reservations-heading">
      <h2 id="reservations-heading" className="text-lg font-semibold">
        {t('heading')}
      </h2>
      <p className="text-text-muted text-sm">{byOrder ? t('orderIntro') : t('itemIntro')}</p>
      <FailureMessage failure={failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={list.items}
        rowKey={(r) => r.id}
        empty={<EmptyState message={t('empty')} />}
      />
      {list.more ? <p className="text-text-muted text-sm">{t('more')}</p> : null}
      {open === undefined ? null : (
        <ChangeDialog
          open={open}
          hubs={hubs}
          extendAuthority={extendAuthority}
          onClose={() => {
            setOpen(undefined);
          }}
          onDone={done}
        />
      )}
    </section>
  );
}

function ChangeDialog({
  open,
  hubs,
  extendAuthority,
  onClose,
  onDone,
}: {
  open: Open;
  hubs: readonly HubDto[];
  extendAuthority: ExtendAuthority | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations('inventory.reservations');
  const common = useTranslations('common');
  const extend = useCommand(extendReservation);
  const release = useCommand(releaseReservation);
  const move = useCommand(moveReservation);
  const current = open.change === 'extend' ? extend : open.change === 'release' ? release : move;
  const { fieldError, formFailure } = useFieldFailure(current.failure, ['reason', 'hubId']);
  const [problem, setProblem] = useState<'reason' | 'hub' | undefined>();
  const { row } = open;
  const otherHubs = hubs.filter(
    (h) => h.id !== row.hubId && h.kind !== 'transit' && h.archivedAt === null,
  );

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (current.pending) return;
    const data = new FormData(e.currentTarget);
    const base = { entityId: row.entityId, reservationId: row.id };
    if (open.change === 'move') {
      const hubId = formText(data, 'hubId');
      if (hubId === '') {
        setProblem('hub');
        return;
      }
      setProblem(undefined);
      move.run({ ...base, hubId }, () => {
        onDone(t('moved'));
      });
      return;
    }
    const reason = formText(data, 'reason').trim();
    if (reasonProblem(reason)) {
      setProblem('reason');
      return;
    }
    setProblem(undefined);
    if (open.change === 'extend' && extendAuthority !== null) {
      extend.run({ ...base, authority: extendAuthority, reason }, () => {
        onDone(t('extendedToast'));
      });
    } else if (open.change === 'release') {
      release.run({ ...base, reason }, () => {
        onDone(t('released'));
      });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={open.returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t(`${open.change}Title`)}</DialogTitle>
            <DialogDescription>
              {t(`${open.change}Intro`)}{' '}
              <span className="tabular-nums">
                {`${row.itemName} · ${plainQuantity(row.qty)} · ${formatDateTime(row.expiresAt)}`}
              </span>
            </DialogDescription>
          </DialogHeader>
          {open.change === 'move' ? (
            <Field
              id="reservation-hub"
              label={t('hub')}
              error={problem === 'hub' ? t('hubRequired') : fieldError('hubId')}
            >
              <Select name="hubId" defaultValue="">
                <option value="">{t('chooseHub')}</option>
                {otherHubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field
              id="reservation-reason"
              label={t('reason')}
              helper={t('reasonHelper')}
              error={problem === 'reason' ? t('reasonInvalid') : fieldError('reason')}
            >
              <Textarea name="reason" rows={3} maxLength={300} />
            </Field>
          )}
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button
              type="submit"
              variant={open.change === 'release' ? 'danger' : 'primary'}
              pending={current.pending}
            >
              {t(`${open.change}Submit`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The orders waiting for an item (H2, the stock card), in the order its free stock goes to them:
 * first confirmed first, a hold that ended waiting behind those already waiting.
 */
export function BackordersPanel({ list }: { list: BackorderListDto }) {
  const t = useTranslations('inventory.backorders');
  const holds = useTranslations('inventory.reservations');
  const columns: DataGridColumn<BackorderRowDto>[] = [
    {
      id: 'order',
      header: t('columns.order'),
      primary: true,
      cell: (b) =>
        b.soNo === null ? (
          <span className="text-text-muted">{holds('orderHidden')}</span>
        ) : (
          <span className="flex flex-col">
            <span className="tabular-nums">{b.soNo}</span>
            {b.linePosition === null ? null : (
              <span className="text-text-muted text-xs">
                {holds('line', { position: b.linePosition })}
              </span>
            )}
          </span>
        ),
    },
    {
      id: 'waiting',
      header: t('columns.waiting'),
      numeric: true,
      cell: (b) => plainQuantity(b.backordered),
    },
    {
      id: 'needed',
      header: t('columns.needed'),
      numeric: true,
      cell: (b) => plainQuantity(b.needed),
    },
    {
      id: 'since',
      header: t('columns.since'),
      cell: (b) => <time dateTime={b.queuedAt}>{formatDateTime(b.queuedAt)}</time>,
    },
  ];
  return (
    <section className="flex flex-col gap-2" aria-labelledby="backorders-heading">
      <h2 id="backorders-heading" className="text-lg font-semibold">
        {t('heading')}
      </h2>
      <p className="text-text-muted text-sm">{t('intro')}</p>
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={list.items}
        rowKey={(b) => `${b.orderId}:${String(b.linePosition ?? 0)}:${b.queuedAt}`}
        empty={<EmptyState message={t('empty')} />}
      />
      {list.more ? <p className="text-text-muted text-sm">{t('more')}</p> : null}
    </section>
  );
}
