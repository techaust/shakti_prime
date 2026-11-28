'use client';

import type { HubDto, StockCardDto, StockMovementRowDto } from '@shakti/contracts';
import { Button, DataGrid, EmptyState, type DataGridColumn, type ReturnFocusTo } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRef, useState } from 'react';
import { getStockCard } from '../../actions/inventory';
import { useCatalogueText } from '../catalogue/use-spec-text';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import { MovementsTable } from './movements-table';

// The forms are loaded only when someone opens one.
const AdjustDialog = dynamic(() => import('./stock-dialogs').then((m) => m.AdjustDialog));
const MoveDialog = dynamic(() => import('./stock-dialogs').then((m) => m.MoveDialog));
const ReverseDialog = dynamic(() => import('./stock-dialogs').then((m) => m.ReverseDialog));

const PAGE_SIZE = 50;

type Open =
  | { kind: 'adjust'; returnFocusTo: ReturnFocusTo }
  | { kind: 'move'; returnFocusTo: ReturnFocusTo }
  | { kind: 'reverse'; movement: StockMovementRowDto; returnFocusTo: ReturnFocusTo };

type HubRow = StockCardDto['byHub'][number];

/**
 * An item's stock card in one company (docs/03-roadmap-appendix/phase3.md §6.2): what each hub
 * holds, and every movement newest first. With the grants for them, Adjust stock and Move between
 * bins open their forms, and a movement made in error is reversed from its row.
 */
export function StockCardScreen({
  initial,
  hubs,
  canAdjust,
  canMove,
}: {
  initial: StockCardDto;
  hubs: readonly HubDto[];
  canAdjust: boolean;
  canMove: boolean;
}) {
  const t = useTranslations('inventory.card');
  const common = useTranslations('common');
  const catalogue = useCatalogueText();
  const [card, setCard] = useState(initial);
  const [open, setOpen] = useState<Open | undefined>();
  const { load, pending, failure } = useQuery<StockCardDto>();
  const adjustButton = useRef<HTMLButtonElement>(null);
  const moveButton = useRef<HTMLButtonElement>(null);
  const entityId = card.entityId;

  function reload() {
    load(
      () => getStockCard({ entityId, itemId: card.item.id, limit: PAGE_SIZE }),
      (fresh) => {
        setCard(fresh);
      },
    );
  }

  const hubColumns: DataGridColumn<HubRow>[] = [
    { id: 'hub', header: t('columns.hub'), primary: true, cell: (h) => h.hubName },
    {
      id: 'onHand',
      header: t('columns.onHand'),
      numeric: true,
      cell: (h) => catalogue.quantity(card.item.unit, Number(h.onHand)),
    },
    {
      id: 'reserved',
      header: t('columns.reserved'),
      numeric: true,
      cell: (h) => catalogue.quantity(card.item.unit, Number(h.reserved)),
    },
  ];

  const done = () => {
    setOpen(undefined);
    reload();
  };
  const close = () => {
    setOpen(undefined);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-muted text-sm">
          {t('summary', { sku: card.item.sku, category: catalogue.category(card.item.category) })}
        </span>
        <span className="grow" />
        {canAdjust && card.item.isActive ? (
          <Button
            ref={adjustButton}
            onClick={() => {
              setOpen({ kind: 'adjust', returnFocusTo: () => [adjustButton.current] });
            }}
          >
            {t('adjust')}
          </Button>
        ) : null}
        {canMove && card.item.isActive ? (
          <Button
            variant="secondary"
            ref={moveButton}
            onClick={() => {
              setOpen({ kind: 'move', returnFocusTo: () => [moveButton.current] });
            }}
          >
            {t('moveBins')}
          </Button>
        ) : null}
      </div>
      <section className="flex flex-col gap-2" aria-labelledby="stock-card-hubs">
        <h2 id="stock-card-hubs" className="text-lg font-semibold">
          {t('byHub')}
        </h2>
        {card.hiddenByCount && card.byHub.length > 0 ? (
          <p role="status" className="text-text-muted text-sm">
            {t('countingHidden')}
          </p>
        ) : null}
        <DataGrid
          caption={t('byHubCaption')}
          columns={hubColumns}
          rows={card.byHub}
          rowKey={(h) => h.hubId}
          empty={<EmptyState message={card.hiddenByCount ? t('countingNone') : t('noStock')} />}
        />
      </section>
      <section className="flex flex-col gap-2" aria-labelledby="stock-card-movements">
        <h2 id="stock-card-movements" className="text-lg font-semibold">
          {t('movements')}
        </h2>
        <FailureMessage failure={failure} />
        <MovementsTable
          entityId={entityId}
          movements={card.movements}
          onReverse={
            canAdjust
              ? (movement, returnFocusTo) => {
                  setOpen({ kind: 'reverse', movement, returnFocusTo });
                }
              : undefined
          }
          loadMore={
            card.nextCursor === null
              ? undefined
              : {
                  label: common('loadMore'),
                  pending,
                  onLoadMore: () => {
                    load(
                      () =>
                        getStockCard({
                          entityId,
                          itemId: card.item.id,
                          limit: PAGE_SIZE,
                          cursor: card.nextCursor ?? undefined,
                        }),
                      (page) => {
                        setCard((c) => ({
                          ...c,
                          movements: [...c.movements, ...page.movements],
                          nextCursor: page.nextCursor,
                        }));
                      },
                    );
                  },
                }
          }
        />
      </section>
      {open?.kind === 'adjust' ? (
        <AdjustDialog
          entityId={entityId}
          item={card.item}
          hubs={hubs}
          returnFocusTo={open.returnFocusTo}
          onClose={close}
          onSaved={done}
        />
      ) : null}
      {open?.kind === 'move' ? (
        <MoveDialog
          entityId={entityId}
          item={card.item}
          hubs={hubs}
          returnFocusTo={open.returnFocusTo}
          onClose={close}
          onSaved={done}
        />
      ) : null}
      {open?.kind === 'reverse' ? (
        <ReverseDialog
          entityId={entityId}
          movement={open.movement}
          returnFocusTo={open.returnFocusTo}
          onClose={close}
          onSaved={done}
        />
      ) : null}
    </div>
  );
}
