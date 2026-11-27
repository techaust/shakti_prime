'use client';

import type { PaymentMilestoneDto, ProformaDto } from '@shakti/contracts';
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
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import type { SyntheticEvent } from 'react';
import { cancelProforma, waiveMilestone } from '../../actions/finance';
import { MILESTONE_REASON_MAX } from '../../screens/contract-values';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/** What a reason dialog acts on: a payment to waive, or a proforma to cancel. */
export type PaymentDialogTarget =
  { kind: 'waive'; milestone: PaymentMilestoneDto } | { kind: 'cancel'; proforma: ProformaDto };

/**
 * The Payments tab's two moves that need a reason: the Executive waives a payment
 * (`finance.milestone.waive`), Accounts cancel a proforma (`finance.proforma.cancel`).
 */
export function PaymentDialog({
  target,
  onClose,
  onDone,
}: {
  target: PaymentDialogTarget;
  onClose: () => void;
  /** Called with the sentence the toast shows once the move is saved. */
  onDone: (saved: string) => void;
}) {
  const t = useTranslations(`finance.${target.kind}`);
  const common = useTranslations('common');
  const waive = useCommand(waiveMilestone);
  const cancel = useCommand(cancelProforma);
  const command = target.kind === 'waive' ? waive : cancel;
  const { fieldError, formFailure } = useFieldFailure(command.failure, ['reason']);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (command.pending) return;
    const reason = formText(new FormData(e.currentTarget), 'reason').trim();
    const done = () => {
      onDone(t('done'));
    };
    if (target.kind === 'waive') {
      waive.run(
        { entityId: target.milestone.entityId, milestoneId: target.milestone.id, reason },
        done,
      );
    } else {
      cancel.run(
        { entityId: target.proforma.entityId, proformaId: target.proforma.id, reason },
        done,
      );
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>
              {t('intro')}{' '}
              {target.kind === 'waive' ? target.milestone.label : target.proforma.proformaNo}
            </DialogDescription>
          </DialogHeader>
          <Field
            id={`payment-${target.kind}-reason`}
            label={t('reason')}
            error={fieldError('reason')}
          >
            <Textarea name="reason" maxLength={MILESTONE_REASON_MAX} rows={3} required />
          </Field>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" variant="danger" pending={command.pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
