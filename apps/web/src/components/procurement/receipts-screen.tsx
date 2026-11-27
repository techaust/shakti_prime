'use client';

import type { GoodsReceiptPageDto, GoodsReceiptRowDto } from '@shakti/contracts';
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
  StatusBadge,
  Textarea,
  toast,
  type ReturnFocusTo,
  useFocusTargets,
  type DataGridColumn,
} from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { listGoodsReceipts, reverseGoodsReceipt } from '../../actions/purchase-orders';
import { formatDateTime } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

const PAGE_SIZE = 50;

/**
 * A company's goods receipts, newest first, or one order's (docs/03-roadmap-appendix/phase3.md
 * §7.2): number, order, vendor, hub, when and by whom, lines and serials; no rate. A holder of
 * `procurement.grn.write` reverses a whole receipt with a reason, which the command refuses once
 * any of its stock or serials has moved on.
 */
export function ReceiptsList({
  initial,
  entityId,
  purchaseOrderId,
  canReverse,
}: {
  initial: GoodsReceiptPageDto;
  entityId: number;
  purchaseOrderId?: string;
  canReverse: boolean;
}) {
  const t = useTranslations('procurement.receipts');
  const common = useTranslations('common');
  const router = useRouter();
  const [rows, setRows] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [reversing, setReversing] = useState<GoodsReceiptRowDto | undefined>();
  const buttons = useFocusTargets<string>();
  const { load, pending, failure } = useQuery<GoodsReceiptPageDto>();

  function loadMore() {
    if (nextCursor === null) return;
    load(
      () =>
        listGoodsReceipts({
          entityId,
          ...(purchaseOrderId === undefined ? {} : { purchaseOrderId }),
          cursor: nextCursor,
          limit: PAGE_SIZE,
        }),
      (page) => {
        setRows((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      },
    );
  }

  const columns: DataGridColumn<GoodsReceiptRowDto>[] = [
    { id: 'grnNo', header: t('columns.number'), primary: true, cell: (r) => r.grnNo },
    {
      id: 'order',
      header: t('columns.order'),
      cell: (r) => (
        <Link
          href={`/procurement/orders/${r.purchaseOrderId}` as Route}
          className="text-accent-text underline-offset-4 hover:underline"
        >
          {r.poNo}
        </Link>
      ),
    },
    { id: 'vendor', header: t('columns.vendor'), cell: (r) => r.vendorName },
    { id: 'hub', header: t('columns.hub'), cell: (r) => r.hubName },
    {
      id: 'received',
      header: t('columns.received'),
      cell: (r) => `${formatDateTime(r.receivedAt)}${r.receivedByName === null ? '' : ` · ${r.receivedByName}`}`,
    },
    { id: 'invoice', header: t('columns.invoice'), cell: (r) => r.vendorInvoiceNo ?? '' },
    { id: 'lines', header: t('columns.lines'), numeric: true, align: 'end', cell: (r) => r.lineCount },
    { id: 'serials', header: t('columns.serials'), numeric: true, align: 'end', cell: (r) => r.serialCount },
    {
      id: 'state',
      header: t('columns.state'),
      cell: (r) =>
        r.state === 'reversed' ? (
          <StatusBadge tone="danger">{t('reversed')}</StatusBadge>
        ) : canReverse ? (
          <Button
            ref={buttons.ref(r.id)}
            size="sm"
            variant="secondary"
            onClick={() => setReversing(r)}
            aria-label={t('reverseLabel', { number: r.grnNo })}
          >
            {t('reverse')}
          </Button>
        ) : (
          <StatusBadge tone="success">{t('inStock')}</StatusBadge>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {failure === undefined ? null : <FailureMessage failure={failure} />}
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={<EmptyState message={t('empty')} />}
        loadMore={
          nextCursor === null
            ? undefined
            : { label: common('loadMore'), onLoadMore: loadMore, pending }
        }
      />
      {reversing === undefined ? null : (
        <ReverseDialog
          receipt={reversing}
          returnFocusTo={() => [buttons.get(reversing.id)]}
          onClose={() => setReversing(undefined)}
          onDone={() => {
            const id = reversing.id;
            setReversing(undefined);
            setRows((current) => current.map((r) => (r.id === id ? { ...r, state: 'reversed' } : r)));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ReverseDialog({
  receipt,
  returnFocusTo,
  onClose,
  onDone,
}: {
  receipt: GoodsReceiptRowDto;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('procurement.receipts');
  const common = useTranslations('common');
  const reverse = useCommand(reverseGoodsReceipt);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = formText(new FormData(e.currentTarget), 'reason').trim();
    reverse.run({ receiptId: receipt.id, reason }, () => {
      toast.success(t('reversedToast', { number: receipt.grnNo }));
      onDone();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} returnFocusTo={returnFocusTo}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('reverseTitle', { number: receipt.grnNo })}</DialogTitle>
            <DialogDescription>{t('reverseIntro')}</DialogDescription>
          </DialogHeader>
          <Field id="receipt-reason" label={t('reason')}>
            <Textarea name="reason" required maxLength={300} rows={3} />
          </Field>
          {reverse.failure === undefined ? null : <FailureMessage failure={reverse.failure} />}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" variant="danger" pending={reverse.pending}>
              {t('reverseConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
