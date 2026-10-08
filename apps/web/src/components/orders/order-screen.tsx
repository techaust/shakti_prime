'use client';

import type { CreditHoldDto, SalesOrderDto, SalesOrderReasonInput } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  StatusBadge,
  Textarea,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { cancelOrder, confirmOrder, releaseOrderCredit } from '../../actions/orders';
import type { ActionResult } from '../../actions/result';
import { customerHref } from '../../screens/customers';
import { formatCount, formatDateTime, formatRupees } from '../../screens/format';
import { ORDER_STATE_TONE } from '../../screens/orders';
import { quoteHref } from '../../screens/quotes';
import { QuoteLinesTable, QuoteTotals } from '../quotes/quote-tables';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';
import { Page } from '../shell/page';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** The sentence a credit hold reads as: the limit and the exposure, or the overdue invoice. */
function HoldNote({ hold }: { hold: CreditHoldDto }) {
  const t = useTranslations('orders.hold');
  const text =
    hold.reason === 'credit_limit_exceeded'
      ? t('overLimit', {
          exposure: formatRupees(hold.exposure ?? '0.00'),
          limit: formatRupees(hold.limit ?? '0.00'),
        })
      : hold.reason === 'credit_overdue'
        ? t('overdue', {
            invoice: hold.invoiceNo ?? '',
            days: formatCount(hold.invoiceAgeDays ?? 0),
            creditDays: formatCount(hold.creditDays ?? 0),
          })
        : t('noLimit');
  return (
    <div
      role="alert"
      className="border-warning bg-warning-soft flex flex-col gap-1 rounded-lg border p-3"
    >
      <p className="font-medium">{t('heading')}</p>
      <p>{text}</p>
      <p className="text-sm">{t('heldAt', { time: formatDateTime(hold.heldAt) })}</p>
    </div>
  );
}

type ReasonAction = (
  input: SalesOrderReasonInput,
  idempotencyKey?: unknown,
) => Promise<ActionResult<SalesOrderDto>>;

/**
 * The order page (docs/03-roadmap-appendix/phase1.md §8.3): the order as it was made, with its lines and
 * totals, and the moves the caller may make: confirm it (the credit check may hold it, and the
 * page then says why in plain words), release a hold (the Executive, with a reason), or cancel it
 * (the General Manager and the Executive, with a reason).
 */
export function OrderScreen({ initial, company }: { initial: SalesOrderDto; company: string }) {
  const t = useTranslations('orders');
  const [order, setOrder] = useState(initial);
  const [asking, setAsking] = useState<'release' | 'cancel' | undefined>();
  const confirm = useCommand(confirmOrder);

  const badge =
    order.creditHold === null ? (
      <StatusBadge tone={ORDER_STATE_TONE[order.state]}>{t(`state.${order.state}`)}</StatusBadge>
    ) : (
      <StatusBadge tone="warning">{t('heldForCredit')}</StatusBadge>
    );

  return (
    <Page
      width="detail"
      title={order.soNo}
      description={
        <span className="flex flex-wrap items-center gap-2">
          {badge}
          <Link
            href={customerHref(order.accountId, order.entityId)}
            className="text-accent-text hover:underline"
          >
            {order.customerName}
          </Link>
        </span>
      }
      actions={
        <>
          <Button asChild variant="secondary">
            <Link href="/orders">{t('page.back')}</Link>
          </Button>
          {order.canCancel ? (
            <Button
              variant="secondary"
              onClick={() => {
                setAsking('cancel');
              }}
            >
              {t('page.cancel')}
            </Button>
          ) : null}
          {order.canRelease ? (
            <Button
              variant="secondary"
              onClick={() => {
                setAsking('release');
              }}
            >
              {t('page.release')}
            </Button>
          ) : null}
          {order.canConfirm ? (
            <Button
              pending={confirm.pending}
              onClick={() => {
                confirm.run({ entityId: order.entityId, orderId: order.id }, (result) => {
                  setOrder(result.order);
                  if (result.outcome === 'confirmed') toast.success(t('page.confirmed'));
                });
              }}
            >
              {t('page.confirmOrder')}
            </Button>
          ) : null}
        </>
      }
    >
      <FailureMessage failure={confirm.failure} />
      {order.creditHold === null ? null : <HoldNote hold={order.creditHold} />}
      {order.creditHold !== null && order.canRelease ? (
        <p className="text-text-muted text-sm">{t('page.releaseIntro')}</p>
      ) : null}
      {order.state === 'draft' && order.canConfirm && order.creditHold === null ? (
        <p className="text-text-muted text-sm">{t('page.confirmIntro')}</p>
      ) : null}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Detail label={t('columns.company')}>{company}</Detail>
        <Detail label={t('page.madeOn')}>
          <time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time>
        </Detail>
        <Detail label={t('page.madeBy')}>{order.createdByName ?? ''}</Detail>
        <Detail label={t('columns.source')}>
          {order.quoteId === null ? (
            t('fromDealer')
          ) : (
            <Link
              href={quoteHref(order.entityId, order.quoteId)}
              className="text-accent-text tabular-nums hover:underline"
            >
              {order.quoteNo ?? ''}
            </Link>
          )}
        </Detail>
        {order.tierName === null ? null : <Detail label={t('page.tier')}>{order.tierName}</Detail>}
        {order.confirmedAt === null ? null : (
          <Detail label={t('page.confirmedOn')}>
            <time dateTime={order.confirmedAt}>{formatDateTime(order.confirmedAt)}</time>
            {order.confirmedByName === null ? null : ` · ${order.confirmedByName}`}
          </Detail>
        )}
        {order.creditRelease === null ? null : (
          <Detail label={t('page.released')}>
            {t('page.releasedBy', {
              name: order.creditRelease.byName ?? '',
              reason: order.creditRelease.reason,
            })}
          </Detail>
        )}
        {order.cancelReason === null ? null : (
          <Detail label={t('page.cancelledBecause')}>{order.cancelReason}</Detail>
        )}
      </dl>

      <QuoteLinesTable lines={order.lines} caption={t('page.linesCaption')} />
      <QuoteTotals totals={order.totals} supplyKind={order.supplyKind} />

      {asking === undefined ? null : (
        <ReasonDialog
          order={order}
          kind={asking}
          action={asking === 'release' ? releaseOrderCredit : cancelOrder}
          onCancel={() => {
            setAsking(undefined);
          }}
          onDone={(next) => {
            setAsking(undefined);
            setOrder(next);
            toast.success(asking === 'release' ? t('page.releasedToast') : t('page.cancelled'));
          }}
        />
      )}
    </Page>
  );
}

function ReasonDialog({
  order,
  kind,
  action,
  onCancel,
  onDone,
}: {
  order: SalesOrderDto;
  kind: 'release' | 'cancel';
  action: ReasonAction;
  onCancel: () => void;
  onDone: (order: SalesOrderDto) => void;
}) {
  const t = useTranslations(`orders.${kind}`);
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(action);
  const { fieldError, formFailure } = useFieldFailure(failure, ['reason']);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const reason = formText(new FormData(e.currentTarget), 'reason').trim();
    run({ entityId: order.entityId, orderId: order.id, reason }, onDone);
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <Field id={`order-${kind}-reason`} label={t('reason')} error={fieldError('reason')}>
            <Textarea name="reason" maxLength={300} rows={3} required />
          </Field>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onCancel}>
              {common('cancel')}
            </Button>
            <Button
              type="submit"
              variant={kind === 'cancel' ? 'danger' : 'primary'}
              pending={pending}
            >
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
