'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Textarea,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import type { Route } from 'next';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type SyntheticEvent } from 'react';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  sendPurchaseOrder,
} from '../../actions/purchase-orders';
import type { OrderActions as Allowed } from '../../screens/purchase-orders';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/**
 * What a person may do with the order in its state (`orderActions()`): approve, mark sent, receive
 * goods, cancel or close with a reason, change a draft; and download its PDF once it prints (from
 * its approval on). Each command checks
 * again; the screen reloads with what the order now is.
 */
export function OrderActionsBar({
  orderId,
  poNo,
  allowed,
}: {
  orderId: string;
  poNo: string;
  allowed: Allowed;
}) {
  const t = useTranslations('procurement.orderActions');
  const router = useRouter();
  const approve = useCommand(approvePurchaseOrder);
  const send = useCommand(sendPurchaseOrder);
  const [reasonFor, setReasonFor] = useState<'cancel' | 'close' | undefined>();
  const cancelButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const failure = approve.failure ?? send.failure;

  const done = (message: string) => () => {
    toast.success(message);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {allowed.approve ? (
          <Button
            pending={approve.pending}
            onClick={() => {
              approve.run({ purchaseOrderId: orderId }, done(t('approved', { number: poNo })));
            }}
          >
            {t('approve')}
          </Button>
        ) : null}
        {allowed.send ? (
          <Button
            pending={send.pending}
            onClick={() => {
              send.run(
                { purchaseOrderId: orderId, via: 'by_hand' },
                done(t('sent', { number: poNo })),
              );
            }}
          >
            {t('markSent')}
          </Button>
        ) : null}
        {allowed.receive ? (
          <Button asChild>
            <Link href={`/procurement/orders/${orderId}/receive` as Route}>{t('receive')}</Link>
          </Button>
        ) : null}
        {allowed.edit ? (
          <Button asChild variant="secondary">
            <Link href={`/procurement/orders/${orderId}/edit` as Route}>{t('edit')}</Link>
          </Button>
        ) : null}
        {allowed.pdf ? (
          <Button asChild variant="secondary">
            <a href={`/procurement/orders/${orderId}/pdf`} target="_blank" rel="noopener">
              {t('pdf')}
            </a>
          </Button>
        ) : null}
        {allowed.cancel ? (
          <Button
            ref={cancelButton}
            variant="secondary"
            onClick={() => {
              setReasonFor('cancel');
            }}
          >
            {t('cancel')}
          </Button>
        ) : null}
        {allowed.close ? (
          <Button
            ref={closeButton}
            variant="secondary"
            onClick={() => {
              setReasonFor('close');
            }}
          >
            {t('close')}
          </Button>
        ) : null}
      </div>
      {failure === undefined ? null : <FailureMessage failure={failure} />}
      {reasonFor === undefined ? null : (
        <ReasonDialog
          kind={reasonFor}
          orderId={orderId}
          poNo={poNo}
          returnFocusTo={() => [
            reasonFor === 'cancel' ? cancelButton.current : closeButton.current,
          ]}
          onClose={() => {
            setReasonFor(undefined);
          }}
          onDone={() => {
            setReasonFor(undefined);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ReasonDialog({
  kind,
  orderId,
  poNo,
  returnFocusTo,
  onClose,
  onDone,
}: {
  kind: 'cancel' | 'close';
  orderId: string;
  poNo: string;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('procurement.orderActions');
  const common = useTranslations('common');
  const cancel = useCommand(cancelPurchaseOrder);
  const close = useCommand(closePurchaseOrder);
  const command = kind === 'cancel' ? cancel : close;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = formText(new FormData(e.currentTarget), 'reason').trim();
    command.run({ purchaseOrderId: orderId, reason }, () => {
      toast.success(
        kind === 'cancel' ? t('cancelled', { number: poNo }) : t('closed', { number: poNo }),
      );
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
            <DialogTitle>
              {kind === 'cancel'
                ? t('cancelTitle', { number: poNo })
                : t('closeTitle', { number: poNo })}
            </DialogTitle>
            <DialogDescription>
              {kind === 'cancel' ? t('cancelIntro') : t('closeIntro')}
            </DialogDescription>
          </DialogHeader>
          <Field id="order-reason" label={t('reason')}>
            <Textarea name="reason" required maxLength={300} rows={3} />
          </Field>
          {command.failure === undefined ? null : <FailureMessage failure={command.failure} />}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button
              type="submit"
              variant={kind === 'cancel' ? 'danger' : 'primary'}
              pending={command.pending}
            >
              {kind === 'cancel' ? t('cancelConfirm') : t('closeConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
