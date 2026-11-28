'use client';

import type {
  StockCountMovementDto,
  StockCountReviewDto,
  StockCountReviewLineDto,
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
  StatusBadge,
  Textarea,
  toast,
  type DataGridColumn,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type SyntheticEvent } from 'react';
import { cancelStockCount, postStockCount, recountStockCount } from '../../../actions/stock-counts';
import { formatDateTime, formatRupees } from '../../../screens/format';
import { formatQty } from '../../../screens/inventory';
import {
  countHref,
  countSheetHref,
  countStateTone,
  formatSignedQty,
} from '../../../screens/stock-counts';
import { FailureMessage, useFieldFailure } from '../../screens/failure';
import { formText } from '../../screens/form-data';
import { useCommand } from '../../screens/use-command';
import { useReasonText } from '../use-inventory-text';

const signed = (qty: string) => formatSignedQty(qty, formatQty);

/**
 * The review of a count (`inventory.stock.adjust`): each line against what the records held when
 * it was counted, the stock moved in the counted bins during the count, values only with
 * `finance.cost.read`; ask for an item in a bin again, post the count or cancel it.
 */
export function ReviewScreen({
  review,
  canCount,
}: {
  review: StockCountReviewDto;
  canCount: boolean;
}) {
  const t = useTranslations('inventory.counts.review');
  const states = useTranslations('inventory.counts.states');
  const errors = useTranslations('errors');
  const reason = useReasonText();
  const router = useRouter();
  const { count, lines, movements, progress } = review;
  const recount = useCommand(recountStockCount);
  const [cancelling, setCancelling] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const live = count.state === 'open' || count.state === 'counting' || count.state === 'review';
  const canAskAgain = count.state === 'counting' || count.state === 'review';
  const blocked = lines.some((l) => l.postRefusal !== null);
  const ready =
    count.state === 'review' && progress.toCount === 0 && progress.recountOpen === 0 && !blocked;

  function askAgain(line: StockCountReviewLineDto) {
    recount.run(
      { entityId: count.entityId, countId: count.id, binId: line.binId, itemId: line.itemId },
      () => {
        toast.success(t('recountAsked'));
        router.refresh();
      },
    );
  }

  const columns: DataGridColumn<StockCountReviewLineDto>[] = [
    { id: 'bin', header: t('columns.bin'), cell: (l) => l.binCode },
    {
      id: 'item',
      header: t('columns.item'),
      primary: true,
      cell: (l) => (
        <span className="flex flex-col">
          <span>{l.itemName}</span>
          <span className="text-text-muted text-sm">{l.sku}</span>
          {l.postRefusal === null ? null : (
            <span className="text-warning text-sm">{errors(l.postRefusal)}</span>
          )}
        </span>
      ),
    },
    { id: 'serial', header: t('columns.serial'), cell: (l) => l.serialNo ?? '' },
    {
      id: 'atStart',
      header: t('columns.atStart'),
      numeric: true,
      cell: (l) => formatQty(l.expectedAtStart),
    },
    {
      id: 'moved',
      header: t('columns.moved'),
      numeric: true,
      cell: (l) => signed(l.movedDuringCount),
    },
    {
      id: 'expected',
      header: t('columns.expected'),
      numeric: true,
      cell: (l) => signed(l.expectedAtCount).replace(/^\+/, ''),
    },
    {
      id: 'counted',
      header: t('columns.counted'),
      numeric: true,
      cell: (l) =>
        l.recountOpen ? (
          <StatusBadge tone="warning">{t('recountOpen')}</StatusBadge>
        ) : l.counted === null ? (
          t('notCounted')
        ) : (
          <span className="flex flex-col items-end">
            <span>{formatQty(l.counted)}</span>
            {l.recount !== null && l.firstCount !== null ? (
              <span className="text-text-muted text-sm">
                {t('firstCount', { qty: formatQty(l.firstCount) })}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      id: 'variance',
      header: t('columns.variance'),
      numeric: true,
      cell: (l) =>
        l.variance === null ? (
          ''
        ) : (
          <span className={Number(l.variance) === 0 ? undefined : 'font-semibold'}>
            {signed(l.variance)}
          </span>
        ),
    },
    ...(review.showsValues
      ? [
          {
            id: 'value',
            header: t('columns.value'),
            numeric: true,
            cell: (l: StockCountReviewLineDto) => (l.value === null ? '' : formatRupees(l.value)),
          },
        ]
      : []),
    ...(canAskAgain
      ? [
          {
            id: 'actions',
            header: t('columns.actions'),
            hideOnPhone: false,
            cell: (l: StockCountReviewLineDto) =>
              l.counted === null && !l.recountOpen ? null : l.recountOpen ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  pending={recount.pending}
                  aria-label={t('recountItem', { name: l.itemName, bin: l.binCode })}
                  onClick={() => {
                    askAgain(l);
                  }}
                >
                  {t('recount')}
                </Button>
              ),
          },
        ]
      : []),
  ];

  const movementColumns: DataGridColumn<StockCountMovementDto>[] = [
    {
      id: 'movedAt',
      header: t('movementColumns.movedAt'),
      cell: (m) => formatDateTime(m.movedAt),
    },
    {
      id: 'reason',
      header: t('movementColumns.reason'),
      primary: true,
      cell: (m) => reason(m.reason),
    },
    {
      id: 'item',
      header: t('movementColumns.item'),
      cell: (m) => (m.serialNo === null ? m.sku : `${m.sku} ${m.serialNo}`),
    },
    { id: 'from', header: t('movementColumns.from'), cell: (m) => m.fromBinCode ?? '' },
    { id: 'to', header: t('movementColumns.to'), cell: (m) => m.toBinCode ?? '' },
    { id: 'qty', header: t('movementColumns.qty'), numeric: true, cell: (m) => formatQty(m.qty) },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={countStateTone(count.state)}>{states(count.state)}</StatusBadge>
        <span className="text-text-muted text-sm">
          {`${formatDateTime(count.startedAt)}, ${count.startedByName}`}
        </span>
        <Link
          className="text-accent-text underline-offset-4 hover:underline"
          href={countSheetHref(count.entityId, count.id)}
          target="_blank"
        >
          {t('print')}
          <span className="sr-only">{t('newTab')}</span>
        </Link>
        {canCount && (count.state === 'open' || count.state === 'counting') ? (
          <Link
            className="text-accent-text underline-offset-4 hover:underline"
            href={countHref(count.entityId, count.id)}
          >
            {t('countLink')}
          </Link>
        ) : null}
      </div>
      <FailureMessage failure={recount.failure} />
      <DataGrid
        caption={t('caption')}
        columns={columns}
        rows={lines}
        rowKey={(l) => l.lineId}
        empty={<EmptyState message={t('noLines')} />}
      />
      {review.netValue === null ? null : (
        <p className="text-right font-semibold">
          {t('netValue', { value: formatRupees(review.netValue) })}
        </p>
      )}

      <section aria-labelledby="count-movements" className="flex flex-col gap-2">
        <h2 id="count-movements" className="text-h3">
          {t('movementsCaption')}
        </h2>
        <DataGrid
          caption={t('movementsCaption')}
          columns={movementColumns}
          rows={movements}
          rowKey={(m) => m.id}
          empty={<EmptyState message={t('movementsEmpty')} />}
        />
        {review.moreMovements ? (
          <p className="text-text-muted text-sm">{t('moreMovements')}</p>
        ) : null}
      </section>

      {count.state === 'review' || count.state === 'counting' ? (
        ready ? (
          <PostForm review={review} />
        ) : (
          <p role="status" className="text-text-muted">
            {blocked ? t('blocked') : t('notReady')}
          </p>
        )
      ) : null}

      <div className="flex flex-wrap gap-3">
        {live ? (
          <Button
            ref={cancelButton}
            variant="secondary"
            onClick={() => {
              setCancelling(true);
            }}
          >
            {t('cancel.open')}
          </Button>
        ) : null}
        <Link
          className="text-accent-text min-h-control inline-flex items-center underline-offset-4 hover:underline"
          href="/inventory/counts"
        >
          {t('back')}
        </Link>
      </div>
      {cancelling ? (
        <CancelDialog
          entityId={count.entityId}
          countId={count.id}
          returnFocusTo={() => [cancelButton.current]}
          onClose={() => {
            setCancelling(false);
          }}
        />
      ) : null}
    </div>
  );
}

/** Post the count: the note kept with every movement, and why each missing serial is missing. */
function PostForm({ review }: { review: StockCountReviewDto }) {
  const t = useTranslations('inventory.counts.review.post');
  const router = useRouter();
  const { count, lines } = review;
  const { run, pending, failure } = useCommand(postStockCount);
  const { fieldError, formFailure } = useFieldFailure(failure, ['note']);
  const [problem, setProblem] = useState<string | undefined>();
  const missing = lines.filter(
    (l) => l.serialId !== null && l.variance !== null && Number(l.variance) < 0,
  );

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const note = formText(data, 'note');
    if (note.length < 3 || note.length > 300) {
      setProblem('note');
      return;
    }
    const serialNotes: { lineId: string; note: string }[] = [];
    for (const line of missing) {
      const text = formText(data, `serial-${line.lineId}`);
      if (text === '') continue;
      if (text.length < 3 || text.length > 300) {
        setProblem(line.lineId);
        return;
      }
      serialNotes.push({ lineId: line.lineId, note: text });
    }
    setProblem(undefined);
    run({ entityId: count.entityId, countId: count.id, note, serialNotes }, () => {
      toast.success(t('posted'));
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="count-post" className="flex flex-col gap-3">
      <h2 id="count-post" className="text-h3">
        {t('title')}
      </h2>
      <p className="text-text-muted">{t('intro')}</p>
      <form onSubmit={submit} className="flex max-w-form flex-col gap-4" noValidate>
        <Field
          id="count-post-note"
          label={t('note')}
          helper={t('noteHelper')}
          error={problem === 'note' ? t('noteInvalid') : fieldError('note')}
        >
          <Textarea name="note" rows={3} maxLength={300} />
        </Field>
        {missing.map((line) => (
          <Field
            key={line.lineId}
            id={`count-post-serial-${line.lineId}`}
            label={t('serialNote', { serial: line.serialNo ?? line.sku })}
            error={problem === line.lineId ? t('serialNoteInvalid') : undefined}
          >
            <Input name={`serial-${line.lineId}`} maxLength={300} autoComplete="off" />
          </Field>
        ))}
        <FailureMessage failure={formFailure} />
        <div>
          <Button type="submit" pending={pending}>
            {t('submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Cancel the count, with why; nothing moves. */
function CancelDialog({
  entityId,
  countId,
  returnFocusTo,
  onClose,
}: {
  entityId: number;
  countId: string;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
}) {
  const t = useTranslations('inventory.counts.review.cancel');
  const common = useTranslations('common');
  const router = useRouter();
  const { run, pending, failure } = useCommand(cancelStockCount);
  const { fieldError, formFailure } = useFieldFailure(failure, ['cancelReason']);
  const [problem, setProblem] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const cancelReason = formText(new FormData(e.currentTarget), 'cancelReason');
    if (cancelReason.length < 3 || cancelReason.length > 300) {
      setProblem(true);
      return;
    }
    setProblem(false);
    run({ entityId, countId, cancelReason }, () => {
      toast.success(t('cancelled'));
      onClose();
      router.refresh();
    });
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
          <Field
            id="count-cancel-reason"
            label={t('reason')}
            helper={t('reasonHelper')}
            error={problem ? t('reasonInvalid') : fieldError('cancelReason')}
          >
            <Textarea name="cancelReason" rows={3} maxLength={300} />
          </Field>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {t('keep')}
            </Button>
            <Button type="submit" variant="danger" pending={pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
