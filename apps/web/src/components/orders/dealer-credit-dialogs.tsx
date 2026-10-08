'use client';

import type { DealerCreditHistoryDto, DealerCreditRowDto } from '@shakti/contracts';
import {
  Button,
  DateInput,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { dealerCreditHistory, recordDealerOutstanding, setDealerTerms } from '../../actions/orders';
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatRupees,
  moneyFromTyped,
} from '../../screens/format';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { settle } from '../screens/settle';
import { useCommand } from '../screens/use-command';

export type DealerCreditDialogKind = 'terms' | 'outstanding' | 'history';

/** Whole days a field holds: digits only, or nothing. */
const DAYS = /^\d{1,4}$/;

/**
 * The dialogs of `/dealer-credit`, loaded on first use: Accounts enter a dealer's credit limit and
 * days, or its outstanding as of a date with the oldest unpaid invoice; or read the dealer's
 * entries, newest first. Every entry is kept: a new one replaces nothing.
 */
export function DealerCreditDialog({
  kind,
  entityId,
  dealer,
  onClose,
  onSaved,
}: {
  kind: DealerCreditDialogKind;
  entityId: number;
  dealer: DealerCreditRowDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const common = useTranslations('common');
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        {kind === 'terms' ? (
          <TermsForm entityId={entityId} dealer={dealer} onClose={onClose} onSaved={onSaved} />
        ) : kind === 'outstanding' ? (
          <OutstandingForm
            entityId={entityId}
            dealer={dealer}
            onClose={onClose}
            onSaved={onSaved}
          />
        ) : (
          <History entityId={entityId} dealer={dealer} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FormProps {
  entityId: number;
  dealer: DealerCreditRowDto;
  onClose: () => void;
  onSaved: () => void;
}

function TermsForm({ entityId, dealer, onClose, onSaved }: FormProps) {
  const t = useTranslations('dealerCredit.terms');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setDealerTerms);
  const { fieldError, formFailure } = useFieldFailure(failure, ['creditLimit', 'creditDays']);
  const [problem, setProblem] = useState<'limit' | 'days' | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const limitText = formText(data, 'creditLimit');
    const daysText = formText(data, 'creditDays');
    const creditLimit = limitText === '' ? null : moneyFromTyped(limitText);
    if (creditLimit === undefined) {
      setProblem('limit');
      return;
    }
    if (daysText !== '' && !DAYS.test(daysText)) {
      setProblem('days');
      return;
    }
    setProblem(undefined);
    run(
      {
        entityId,
        accountId: dealer.accountId,
        creditLimit,
        creditDays: daysText === '' ? null : Number(daysText),
      },
      () => {
        toast.success(t('saved'));
        onSaved();
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name: dealer.name })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="dealer-credit-limit"
        label={t('limit')}
        helper={t('limitHelper')}
        error={problem === 'limit' ? t('limitInvalid') : fieldError('creditLimit')}
      >
        <Input
          name="creditLimit"
          inputMode="decimal"
          autoComplete="off"
          maxLength={20}
          defaultValue={dealer.creditLimit ?? ''}
        />
      </Field>
      <Field
        id="dealer-credit-days"
        label={t('days')}
        helper={t('daysHelper')}
        error={problem === 'days' ? t('daysInvalid') : fieldError('creditDays')}
      >
        <Input
          name="creditDays"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          defaultValue={dealer.creditDays === null ? '' : String(dealer.creditDays)}
        />
      </Field>
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function OutstandingForm({ entityId, dealer, onClose, onSaved }: FormProps) {
  const t = useTranslations('dealerCredit.outstanding');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(recordDealerOutstanding);
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'outstanding',
    'oldestUnpaidInvoiceDate',
    'oldestUnpaidInvoiceNo',
    'asOf',
  ]);
  const [problem, setProblem] = useState<
    'amount' | 'date' | 'invoiceDate' | 'invoice' | undefined
  >();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const outstanding = moneyFromTyped(formText(data, 'outstanding'));
    const asOf = formText(data, 'asOf');
    const invoiceDate = formText(data, 'oldestUnpaidInvoiceDate');
    const invoice = formText(data, 'oldestUnpaidInvoiceNo');
    const wrong =
      outstanding === undefined
        ? 'amount'
        : asOf === ''
          ? 'date'
          : (invoiceDate === '') !== (invoice === '')
            ? 'invoice'
            : invoiceDate !== '' && invoiceDate > asOf
              ? 'invoiceDate'
              : undefined;
    setProblem(wrong);
    if (wrong !== undefined || outstanding === undefined) return;
    run(
      {
        entityId,
        accountId: dealer.accountId,
        outstanding,
        asOf,
        oldestUnpaidInvoiceDate: invoiceDate === '' ? null : invoiceDate,
        oldestUnpaidInvoiceNo: invoice === '' ? null : invoice,
      },
      () => {
        toast.success(t('saved'));
        onSaved();
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name: dealer.name })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="dealer-outstanding-amount"
        label={t('amount')}
        error={problem === 'amount' ? t('amountInvalid') : fieldError('outstanding')}
      >
        <Input name="outstanding" inputMode="decimal" autoComplete="off" maxLength={20} />
      </Field>
      <Field
        id="dealer-outstanding-as-of"
        label={t('asOf')}
        helper={t('asOfHelper')}
        error={problem === 'date' ? t('asOfInvalid') : fieldError('asOf')}
      >
        <DateInput name="asOf" />
      </Field>
      <Field
        id="dealer-outstanding-invoice"
        label={t('invoice')}
        helper={t('invoiceHelper')}
        error={problem === 'invoice' ? t('invoiceMissing') : fieldError('oldestUnpaidInvoiceNo')}
      >
        <Input name="oldestUnpaidInvoiceNo" autoComplete="off" maxLength={60} />
      </Field>
      <Field
        id="dealer-outstanding-invoice-date"
        label={t('invoiceDate')}
        helper={t('invoiceDateHelper')}
        error={
          problem === 'invoiceDate'
            ? t('invoiceDateInvalid')
            : fieldError('oldestUnpaidInvoiceDate')
        }
      >
        <DateInput name="oldestUnpaidInvoiceDate" />
      </Field>
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function History({
  entityId,
  dealer,
  onClose,
}: {
  entityId: number;
  dealer: DealerCreditRowDto;
  onClose: () => void;
}) {
  const t = useTranslations('dealerCredit.historyDialog');
  const credit = useTranslations('dealerCredit');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const [history, setHistory] = useState<DealerCreditHistoryDto | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    void settle(() => dealerCreditHistory({ entityId, accountId: dealer.accountId })).then(
      (result) => {
        if (!current) return;
        if (result.ok) setHistory(result.data);
        else setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [entityId, dealer.accountId]);

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t('title', { name: dealer.name })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      {failed ? (
        <p role="alert" className="text-danger">
          {errors('internal')}
        </p>
      ) : history === undefined ? (
        <p role="status" className="text-text-muted">
          {t('loading')}
        </p>
      ) : (
        <>
          <section aria-labelledby="dealer-history-terms" className="flex flex-col gap-2">
            <h3 id="dealer-history-terms" className="font-medium">
              {t('terms')}
            </h3>
            {history.terms.length === 0 ? (
              <p className="text-text-muted">{t('noTerms')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.terms.map((row) => (
                  <li key={row.id} className="flex flex-col">
                    <span>
                      {t('termsLine', {
                        limit:
                          row.creditLimit === null
                            ? credit('notSet')
                            : formatRupees(row.creditLimit),
                        days:
                          row.creditDays === null
                            ? credit('notSet')
                            : credit('days', { days: formatCount(row.creditDays) }),
                      })}
                    </span>
                    <span className="text-text-muted text-sm">
                      {t('entered', {
                        time: formatDateTime(row.enteredAt),
                        name: row.enteredByName ?? '',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="dealer-history-outstanding" className="flex flex-col gap-2">
            <h3 id="dealer-history-outstanding" className="font-medium">
              {t('outstanding')}
            </h3>
            {history.outstanding.length === 0 ? (
              <p className="text-text-muted">{t('noOutstanding')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.outstanding.map((row) => (
                  <li key={row.id} className="flex flex-col">
                    <span>
                      {t('outstandingLine', {
                        amount: formatRupees(row.outstanding),
                        date: formatDate(row.asOf),
                      })}
                    </span>
                    {row.oldestUnpaidInvoiceNo === null ? null : (
                      <span className="text-sm">
                        {credit('unpaidDated', {
                          invoice: row.oldestUnpaidInvoiceNo,
                          date: formatDate(row.oldestUnpaidInvoiceDate ?? row.asOf),
                        })}
                      </span>
                    )}
                    <span className="text-text-muted text-sm">
                      {t('entered', {
                        time: formatDateTime(row.enteredAt),
                        name: row.enteredByName ?? '',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          {common('close')}
        </Button>
      </DialogFooter>
    </div>
  );
}
