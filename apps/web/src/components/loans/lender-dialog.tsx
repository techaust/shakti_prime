'use client';

import type { LenderDto } from '@shakti/contracts';
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
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { createLender, updateLender } from '../../actions/loans';
import { lenderNameOk } from '../../screens/loans';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/** Settings › Lenders' dialog: a lender added to the company's list, or renamed. */
export function LenderDialog({
  entityId,
  lender,
  onClose,
  onSaved,
}: {
  entityId: number;
  lender: LenderDto | undefined;
  onClose: () => void;
  onSaved: (saved: string) => void;
}) {
  const t = useTranslations('loans.lenders');
  const common = useTranslations('common');
  const add = useCommand(createLender);
  const rename = useCommand(updateLender);
  const command = lender === undefined ? add : rename;
  const { fieldError, formFailure } = useFieldFailure(command.failure, ['name']);
  const [problem, setProblem] = useState(false);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (command.pending) return;
    const name = formText(new FormData(e.currentTarget), 'name').trim();
    if (!lenderNameOk(name)) {
      setProblem(true);
      return;
    }
    setProblem(false);
    if (lender === undefined) {
      add.run({ entityId, name }, () => {
        onSaved(t('added'));
      });
    } else {
      rename.run({ entityId, lenderId: lender.id, name }, () => {
        onSaved(t('renamed'));
      });
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
            <DialogTitle>{lender === undefined ? t('addTitle') : t('renameTitle')}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <Field
            id="lender-name"
            label={t('nameLabel')}
            error={problem ? t('nameInvalid') : fieldError('name')}
          >
            <Input
              name="name"
              autoComplete="off"
              maxLength={120}
              defaultValue={lender?.name ?? ''}
              required
            />
          </Field>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={command.pending}>
              {lender === undefined ? t('submitAdd') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
