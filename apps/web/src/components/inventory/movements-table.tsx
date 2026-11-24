'use client';

import type { StockMovementRowDto } from '@shakti/contracts';
import {
  Button,
  DataGrid,
  EmptyState,
  type DataGridColumn,
  type LoadMore,
  type ReturnFocusTo,
  useFocusTargets,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatDateTime } from '../../screens/format';
import { formatQty, serialHref } from '../../screens/inventory';
import { useReasonText } from './use-inventory-text';

/**
 * A stock card's or a serial's movements, newest first: when, why, how much, from and to which
 * bin, the serial, who moved it and their note. A movement the caller may still reverse has a
 * Reverse button (`onReverse`); one already reversed says so.
 */
export function MovementsTable({
  entityId,
  movements,
  loadMore,
  onReverse,
}: {
  entityId: number;
  movements: readonly StockMovementRowDto[];
  loadMore?: LoadMore | undefined;
  onReverse?: ((movement: StockMovementRowDto, returnFocusTo: ReturnFocusTo) => void) | undefined;
}) {
  const t = useTranslations('inventory.movements');
  const reason = useReasonText();
  const places = useFocusTargets<string>();
  const bin = (b: StockMovementRowDto['from']) =>
    b === null ? t('none') : t('binIn', { bin: b.code, hub: b.hubCode });

  const columns: DataGridColumn<StockMovementRowDto>[] = [
    {
      id: 'when',
      header: t('columns.when'),
      primary: true,
      cell: (m) => <time dateTime={m.movedAt}>{formatDateTime(m.movedAt)}</time>,
    },
    {
      id: 'reason',
      header: t('columns.reason'),
      cell: (m) => (
        <span className="flex flex-col">
          <span>{reason(m.reason)}</span>
          {m.reversedById === null ? null : (
            <span className="text-text-muted text-xs">{t('reversed')}</span>
          )}
          {m.note === null ? null : <span className="text-text-muted text-xs">{m.note}</span>}
        </span>
      ),
    },
    { id: 'qty', header: t('columns.qty'), numeric: true, cell: (m) => formatQty(m.qty) },
    { id: 'from', header: t('columns.from'), cell: (m) => bin(m.from) },
    { id: 'to', header: t('columns.to'), cell: (m) => bin(m.to) },
    {
      id: 'serial',
      header: t('columns.serial'),
      cell: (m) =>
        m.serialId === null || m.serialNo === null ? (
          t('none')
        ) : (
          <Link
            href={serialHref(entityId, m.serialId)}
            className="text-accent-text hover:underline"
          >
            {m.serialNo}
          </Link>
        ),
    },
    { id: 'by', header: t('columns.by'), cell: (m) => m.movedBy },
  ];
  if (onReverse !== undefined) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">{t('columns.actions')}</span>,
      align: 'end',
      cell: (m) =>
        m.reversible ? (
          <Button
            variant="secondary"
            size="sm"
            ref={places.ref(m.id)}
            onClick={() => {
              onReverse(m, () => [places.get(m.id)]);
            }}
          >
            {t('reverse')}
          </Button>
        ) : null,
    });
  }

  return (
    <DataGrid
      caption={t('caption')}
      columns={columns}
      rows={movements}
      rowKey={(m) => m.id}
      empty={<EmptyState message={t('empty')} />}
      loadMore={loadMore}
    />
  );
}
