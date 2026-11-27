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
  Select,
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

/** One of the vendor's people with an email address, whom the order may be emailed to. */
export interface EmailContact {
  id: string;
  name: string;
  email: string;
}

/**
 * What a person may do with the order in its state (`orderActions()`): approve, send by email to
 * one of the vendor's people (the PDF goes by the mailer) or mark sent by hand, receive
 * goods, cancel or close with a reason, change a draft; and download its PDF once it prints (from
 * its approval on). Each command checks
 * again; the screen reloads with what the order now is.
 */
export function OrderActionsBar({
  orderId,
  poNo,
  allowed,
  emailContacts,
}: {
  orderId: string;
  poNo: string;
  allowed: Allowed;
  /** The vendor's people with an email address; Send by email shows when there is one. */
  emailContacts: EmailContact[];
}) {
  const t = useTranslations('procurement.orderActions');
  const router = useRouter();
  const approve = useCommand(approvePurchaseOrder);
  const send = useCommand(sendPurchaseOrder);
  const [reasonFor, setReasonFor] = useState<'cancel' | 'close' | undefined>();
  const [emailing, setEmailing] = useState(false);
  const emailButton = useRef<HTMLButtonElement>(null);
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
        {allowed.send && emailContacts.length > 0 ? (
          <Button
            ref={emailButton}
            onClick={() => {
              setEmailing(true);
            }}
          >
            {t('sendByEmail')}
          </Button>
        ) : null}
        {allowed.send ? (
          <Button
            variant={emailContacts.length > 0 ? 'secondary' : 'primary'}
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
      {emailing ? (
        <EmailDialog
          orderId={orderId}
          poNo={poNo}
          contacts={emailContacts}
          returnFocusTo={() => [emailButton.current]}
          onClose={() => {
            setEmailing(false);
          }}
          onDone={() => {
            setEmailing(false);
            router.refresh();
          }}
        />
      ) : null}
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

/** Send by email: to which of the vendor's people; the mailer sends the PDF after. */
function EmailDialog({
  orderId,
  poNo,
  contacts,
  returnFocusTo,
  onClose,
  onDone,
}: {
  orderId: string;
  poNo: string;
  contacts: EmailContact[];
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('procurement.orderActions');
  const common = useTranslations('common');
  const send = useCommand(sendPurchaseOrder);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const vendorContactId = formText(new FormData(e.currentTarget), 'contactId');
    send.run({ purchaseOrderId: orderId, via: 'email', vendorContactId }, () => {
      toast.success(t('emailed', { number: poNo }));
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
            <DialogTitle>{t('emailTitle', { number: poNo })}</DialogTitle>
            <DialogDescription>{t('emailIntro')}</DialogDescription>
          </DialogHeader>
          <Field id="order-email-contact" label={t('emailTo')}>
            <Select name="contactId" required defaultValue={contacts[0]?.id ?? ''}>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {t('emailContact', { name: c.name, email: c.email })}
                </option>
              ))}
            </Select>
          </Field>
          {send.failure === undefined ? null : <FailureMessage failure={send.failure} />}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={send.pending}>
              {t('emailConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
