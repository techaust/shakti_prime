'use client';

import type { DispositionDto } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { defaultCallbackLocal, suggestedLostReason, type OutcomeNeed } from '../../screens/calling';
import { OPPORTUNITY_LOST_REASONS, OPPORTUNITY_NURTURE_REASONS } from '../../screens/contract-values';
import { dueFromLocal } from '../../screens/customers';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import type { CommandFailure } from '../screens/use-command';

/** What the dialog adds to the call: the callback time or the reason the outcome needs. */
export type OutcomeDetail =
  | { callbackAt: string }
  | { lostReason: string }
  | { nurtureReason: string };

/**
 * The one detail an outcome needs before the call is saved (`outcomeNeeds`): when to call back,
 * or why the lead is lost or set to follow up later. The first field has focus and Enter saves,
 * so the caller stays on the keyboard; closing it saves nothing.
 */
export function OutcomeDialog({
  outcome,
  need,
  pending,
  failure,
  onSave,
  onCancel,
}: {
  outcome: DispositionDto;
  need: OutcomeNeed;
  pending: boolean;
  failure: CommandFailure | undefined;
  onSave: (detail: OutcomeDetail) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('calling.dialog');
  const leadsT = useTranslations('leads.board');
  const common = useTranslations('common');
  const [startAt] = useState(() => defaultCallbackLocal(new Date()));
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'callbackAt',
    'lostReason',
    'nurtureReason',
  ]);
  const title =
    need === 'callbackTime'
      ? t('callbackTitle')
      : need === 'lostReason'
        ? t('lostTitle')
        : t('nurtureTitle');

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    if (need === 'callbackTime') {
      onSave({ callbackAt: dueFromLocal(formText(data, 'callbackAt')) ?? '' });
    } else if (need === 'lostReason') {
      onSave({ lostReason: formText(data, 'lostReason') });
    } else {
      onSave({ nurtureReason: formText(data, 'nurtureReason') });
    }
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
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {need === 'callbackTime' ? t('callbackIntro') : outcome.label}
            </DialogDescription>
          </DialogHeader>
          {need === 'callbackTime' ? (
            <Field id="call-callback-at" label={t('callbackAt')} error={fieldError('callbackAt')}>
              <Input
                name="callbackAt"
                type="datetime-local"
                defaultValue={startAt}
                required
                autoFocus
              />
            </Field>
          ) : need === 'lostReason' ? (
            <Field id="call-lost-reason" label={t('reason')} error={fieldError('lostReason')}>
              <Select
                name="lostReason"
                defaultValue={suggestedLostReason(outcome.nextAction)}
                autoFocus
              >
                {OPPORTUNITY_LOST_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {leadsT(`lostReason.${reason}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field id="call-nurture-reason" label={t('reason')} error={fieldError('nurtureReason')}>
              <Select name="nurtureReason" defaultValue={OPPORTUNITY_NURTURE_REASONS[0]} autoFocus>
                {OPPORTUNITY_NURTURE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {leadsT(`nurtureReason.${reason}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
