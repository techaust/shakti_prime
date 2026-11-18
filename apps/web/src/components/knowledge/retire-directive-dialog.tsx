'use client';

import type { PlaybookDirectiveDto } from '@shakti/contracts';
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
import { useState, type SyntheticEvent } from 'react';
import { retireDirective } from '../../actions/playbook';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

/** Retire a rule (`knowledge.playbook.retire`) with the reason it no longer holds. */
export function RetireDirectiveDialog({
  directive,
  entityId,
  onClose,
  onRetired,
}: {
  directive: PlaybookDirectiveDto;
  entityId: number;
  onClose: () => void;
  onRetired: (directive: PlaybookDirectiveDto) => void;
}) {
  const t = useTranslations('playbook');
  const common = useTranslations('common');
  const retire = useCommand(retireDirective);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (reason.trim() === '') return;
    retire.run({ entityId, directiveId: directive.id, reason }, onRetired);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <DialogHeader>
          <DialogTitle>{t('retireDialog.title')}</DialogTitle>
          <DialogDescription>
            {t('retireDialog.intro', { title: directive.title })}
          </DialogDescription>
        </DialogHeader>
        <form id="retire-directive" noValidate onSubmit={submit}>
          <Field
            id="retire-reason"
            label={t('retireDialog.reasonLabel')}
            error={tried && reason.trim() === '' ? t('retireDialog.reasonMissing') : undefined}
          >
            <Textarea
              value={reason}
              maxLength={300}
              rows={3}
              required
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </Field>
        </form>
        <FailureMessage failure={retire.failure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('retireDialog.cancel')}
          </Button>
          <Button type="submit" form="retire-directive" variant="danger" pending={retire.pending}>
            {t('retireDialog.retire')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
