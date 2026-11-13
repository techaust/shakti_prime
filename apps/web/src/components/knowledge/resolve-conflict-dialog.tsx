'use client';

import type { PlaybookResolution } from '@shakti/contracts';
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
import { resolveConflict } from '../../actions/playbook';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

/**
 * Settle a clash (`knowledge.playbook.resolve_conflict`): not a clash, saying why both rules can
 * be followed, or by retiring the other rule, saying why it no longer holds.
 */
export function ResolveConflictDialog({
  checkId,
  resolution,
  otherTitle,
  entityId,
  onClose,
  onResolved,
}: {
  checkId: string;
  resolution: PlaybookResolution;
  otherTitle: string;
  entityId: number;
  onClose: () => void;
  onResolved: () => void;
}) {
  const t = useTranslations('playbook');
  const common = useTranslations('common');
  const resolve = useCommand(resolveConflict);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const notAClash = resolution === 'not_a_conflict';

  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (note.trim() === '') return;
    resolve.run({ entityId, checkId, resolution, note }, onResolved);
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
          <DialogTitle>
            {notAClash ? t('resolveDialog.notAClashTitle') : t('resolveDialog.retireOtherTitle')}
          </DialogTitle>
          <DialogDescription>
            {notAClash
              ? t('resolveDialog.notAClashIntro')
              : t('resolveDialog.retireOtherIntro', { title: otherTitle })}
          </DialogDescription>
        </DialogHeader>
        <form id="resolve-conflict" noValidate onSubmit={submit}>
          <Field
            id="resolve-note"
            label={t('resolveDialog.noteLabel')}
            error={tried && note.trim() === '' ? t('resolveDialog.noteMissing') : undefined}
          >
            <Textarea
              value={note}
              maxLength={300}
              rows={3}
              required
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </Field>
        </form>
        <FailureMessage failure={resolve.failure} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('resolveDialog.cancel')}
          </Button>
          <Button
            type="submit"
            form="resolve-conflict"
            variant={notAClash ? 'primary' : 'danger'}
            pending={resolve.pending}
          >
            {notAClash ? t('resolveDialog.notAClash') : t('resolveDialog.retireOther')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
