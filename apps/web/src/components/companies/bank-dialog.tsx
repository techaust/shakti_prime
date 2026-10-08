'use client';

import type { BankDetails, EntityDto } from '@shakti/contracts';
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
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { readCompanyBankDetails, updateEntity } from '../../actions/org';
import { BANK_FIELDS, bankDetailsFrom, type BankField } from '../../screens/companies';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

/**
 * Settings › Companies: the dialog where an Executive records a company's bank account, loaded on
 * demand by the companies screen. The account is read in clear only here, for the Executive
 * changing it, and is stored sealed (docs/07-security.md §5).
 */
export function BankDialog({
  company,
  closeLabel,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  company: EntityDto;
  closeLabel: string;
  returnFocusTo: ReturnFocusTo;
  onSaved: (company: EntityDto) => void;
  onClose: () => void;
}) {
  const t = useTranslations('companies');
  const { load, failure: readFailure } = useQuery<{ bankDetails: BankDetails | null }>();
  const [current, setCurrent] = useState<BankDetails | null | undefined>();

  useEffect(() => {
    load(
      () => readCompanyBankDetails({ entityId: company.id }),
      (data) => {
        setCurrent(data.bankDetails);
      },
    );
  }, [company.id, load]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={closeLabel} returnFocusTo={returnFocusTo}>
        {current === undefined ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('bankTitle', { name: company.legalName })}</DialogTitle>
              <DialogDescription>{t('bankIntro')}</DialogDescription>
            </DialogHeader>
            {readFailure === undefined ? (
              <p className="text-text-muted text-sm" role="status">
                {t('bankLoading')}
              </p>
            ) : (
              <FailureMessage failure={readFailure} />
            )}
          </>
        ) : (
          <BankForm company={company} current={current} onSaved={onSaved} onCancel={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BankForm({
  company,
  current,
  onSaved,
  onCancel,
}: {
  company: EntityDto;
  current: BankDetails | null;
  onSaved: (company: EntityDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('companies');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(updateEntity);
  const failures = useFieldFailure(
    failure,
    BANK_FIELDS.map((field) => `bankDetails.${field}`),
  );
  const fieldError = (field: BankField) => failures.fieldError(`bankDetails.${field}`);
  const formFailure = failures.formFailure;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const typed = Object.fromEntries(BANK_FIELDS.map((f) => [f, formText(data, f)]));
    const bankDetails = bankDetailsFrom(typed);
    // Nothing changed: close without writing an empty change to the Activity log.
    if (current !== null && BANK_FIELDS.every((field) => bankDetails[field] === current[field])) {
      onCancel();
      return;
    }
    run({ entityId: company.id, bankDetails }, onSaved);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('bankTitle', { name: company.legalName })}</DialogTitle>
        <DialogDescription>{t('bankIntro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="bank-name"
        label={t('bankName')}
        helper={t('bankNameHelper')}
        error={fieldError('bankName')}
      >
        <Input
          name="bankName"
          defaultValue={current?.bankName ?? ''}
          required
          minLength={2}
          maxLength={80}
          autoComplete="off"
        />
      </Field>
      <Field
        id="bank-account"
        label={t('accountNumber')}
        helper={t('accountNumberHelper')}
        error={fieldError('accountNumber')}
      >
        <Input
          name="accountNumber"
          defaultValue={current?.accountNumber ?? ''}
          required
          inputMode="numeric"
          maxLength={24}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field id="bank-ifsc" label={t('ifsc')} helper={t('ifscHelper')} error={fieldError('ifsc')}>
        <Input
          name="ifsc"
          defaultValue={current?.ifsc ?? ''}
          required
          maxLength={11}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </Field>
      <Field
        id="bank-branch"
        label={t('branch')}
        helper={t('branchHelper')}
        error={fieldError('branch')}
      >
        <Input
          name="branch"
          defaultValue={current?.branch ?? ''}
          required
          minLength={2}
          maxLength={80}
          autoComplete="off"
        />
      </Field>
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('saveBank')}
        </Button>
      </DialogFooter>
    </form>
  );
}
