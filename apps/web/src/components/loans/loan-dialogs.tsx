'use client';

import type { CustomerLoanDto, OrderLoansDto } from '@shakti/contracts';
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
  Textarea,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { createLoan, disburseLoan, rejectLoan, sanctionLoan } from '../../actions/loans';
import { LOAN_DISPATCH_GATES } from '../../screens/contract-values';
import { moneyFromTyped } from '../../screens/format';
import { lenderNameOk, LOAN_REFERENCE } from '../../screens/loans';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

export type LoanDialogKind = 'create' | 'sanction' | 'disburse' | 'reject';

/** An amount typed in rupees, above zero, as the contract takes it; undefined when it is not. */
function amountOf(typed: string): string | undefined {
  const money = moneyFromTyped(typed);
  return money === undefined || !/[1-9]/.test(money) ? undefined : money;
}

interface FormProps {
  view: OrderLoansDto;
  loan: CustomerLoanDto | undefined;
  onClose: () => void;
  onSaved: (saved: string) => void;
}

/**
 * The Loan tab's dialogs: record a loan on the order, its sanction with the amount, its payout, or
 * the lender's turn-down with the reason. Each runs its command once per form (one idempotency key)
 * and hands the saved sentence back for the toast.
 */
export function LoanDialog({ kind, ...props }: FormProps & { kind: LoanDialogKind }) {
  const common = useTranslations('common');
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onClose();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        {kind === 'create' ? (
          <CreateForm {...props} />
        ) : kind === 'sanction' ? (
          <SanctionForm {...props} />
        ) : kind === 'disburse' ? (
          <DisburseForm {...props} />
        ) : (
          <RejectForm {...props} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Footer({
  pending,
  submit,
  onClose,
  danger = false,
}: {
  pending: boolean;
  submit: string;
  onClose: () => void;
  danger?: boolean;
}) {
  const common = useTranslations('common');
  return (
    <DialogFooter>
      <Button variant="secondary" onClick={onClose}>
        {common('cancel')}
      </Button>
      <Button type="submit" variant={danger ? 'danger' : 'primary'} pending={pending}>
        {submit}
      </Button>
    </DialogFooter>
  );
}

function CreateForm({ view, onClose, onSaved }: FormProps) {
  const t = useTranslations('loans');
  const { run, pending, failure } = useCommand(createLoan);
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'lenderId',
    'lenderName',
    'amount',
    'reference',
    'gates',
  ]);
  const [problem, setProblem] = useState<'lender' | 'amount' | 'reference' | undefined>();
  const fromList = view.lenders.length > 0;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const lender = formText(data, 'lender').trim();
    const amount = amountOf(formText(data, 'amount'));
    const reference = formText(data, 'reference').trim();
    const dispatch = formText(data, 'dispatch');
    const wrong = (fromList ? lender === '' : !lenderNameOk(lender))
      ? 'lender'
      : amount === undefined
        ? 'amount'
        : reference !== '' && !LOAN_REFERENCE.test(reference)
          ? 'reference'
          : undefined;
    setProblem(wrong);
    if (wrong !== undefined || amount === undefined) return;
    run(
      {
        entityId: view.entityId,
        orderId: view.orderId,
        ...(fromList ? { lenderId: lender } : { lenderName: lender }),
        amount,
        reference: reference === '' ? null : reference,
        gates: {
          dispatch: (LOAN_DISPATCH_GATES as readonly string[]).includes(dispatch)
            ? (dispatch as (typeof LOAN_DISPATCH_GATES)[number])
            : 'disbursed',
        },
      },
      () => {
        onSaved(t('create.saved'));
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('create.title')}</DialogTitle>
        <DialogDescription>{t('create.intro')}</DialogDescription>
      </DialogHeader>
      {fromList ? (
        <Field
          id="loan-lender"
          label={t('create.lender')}
          error={problem === 'lender' ? t('create.lenderMissing') : fieldError('lenderId')}
        >
          <Select name="lender" defaultValue="" required>
            <option value="" disabled>
              {t('create.chooseLender')}
            </option>
            {view.lenders.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field
          id="loan-lender-name"
          label={t('create.lenderName')}
          helper={t('create.lenderNameHelper')}
          error={problem === 'lender' ? t('create.lenderNameInvalid') : fieldError('lenderName')}
        >
          <Input name="lender" autoComplete="off" maxLength={120} required />
        </Field>
      )}
      <Field
        id="loan-amount"
        label={t('create.amount')}
        helper={t('create.amountHelper')}
        error={problem === 'amount' ? t('create.amountInvalid') : fieldError('amount')}
      >
        <Input name="amount" inputMode="decimal" autoComplete="off" maxLength={20} required />
      </Field>
      <Field
        id="loan-reference"
        label={t('create.reference')}
        helper={t('create.referenceHelper')}
        error={problem === 'reference' ? t('create.referenceInvalid') : fieldError('reference')}
      >
        <Input name="reference" autoComplete="off" maxLength={60} />
      </Field>
      <Field
        id="loan-dispatch"
        label={t('create.dispatch')}
        helper={t('create.dispatchHelper')}
        error={fieldError('gates')}
      >
        <Select name="dispatch" defaultValue="disbursed">
          {LOAN_DISPATCH_GATES.map((gate) => (
            <option key={gate} value={gate}>
              {t(`dispatchGate.${gate}`)}
            </option>
          ))}
        </Select>
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer pending={pending} submit={t('create.submit')} onClose={onClose} />
    </form>
  );
}

function SanctionForm({ view, loan, onClose, onSaved }: FormProps) {
  const t = useTranslations('loans');
  const { run, pending, failure } = useCommand(sanctionLoan);
  const { fieldError, formFailure } = useFieldFailure(failure, ['sanctionedAmount', 'reference']);
  const [problem, setProblem] = useState<'amount' | 'reference' | undefined>();
  if (loan === undefined) return null;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || loan === undefined) return;
    const data = new FormData(e.currentTarget);
    const amount = amountOf(formText(data, 'sanctionedAmount'));
    const reference = formText(data, 'reference').trim();
    const wrong =
      amount === undefined
        ? 'amount'
        : reference !== '' && !LOAN_REFERENCE.test(reference)
          ? 'reference'
          : undefined;
    setProblem(wrong);
    if (wrong !== undefined || amount === undefined) return;
    run(
      {
        entityId: view.entityId,
        loanId: loan.id,
        sanctionedAmount: amount,
        ...(reference === '' ? {} : { reference }),
      },
      () => {
        onSaved(t('sanction.saved'));
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('sanction.title')}</DialogTitle>
        <DialogDescription>{t('sanction.intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="loan-sanctioned-amount"
        label={t('sanction.amount')}
        helper={t('create.amountHelper')}
        error={problem === 'amount' ? t('create.amountInvalid') : fieldError('sanctionedAmount')}
      >
        <Input
          name="sanctionedAmount"
          inputMode="decimal"
          autoComplete="off"
          maxLength={20}
          defaultValue={loan.amount}
          required
        />
      </Field>
      <Field
        id="loan-sanction-reference"
        label={t('create.reference')}
        helper={t('create.referenceHelper')}
        error={problem === 'reference' ? t('create.referenceInvalid') : fieldError('reference')}
      >
        <Input
          name="reference"
          autoComplete="off"
          maxLength={60}
          defaultValue={loan.reference ?? ''}
        />
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer pending={pending} submit={t('sanction.submit')} onClose={onClose} />
    </form>
  );
}

function DisburseForm({ view, loan, onClose, onSaved }: FormProps) {
  const t = useTranslations('loans');
  const { run, pending, failure } = useCommand(disburseLoan);
  const { fieldError, formFailure } = useFieldFailure(failure, ['reference']);
  const [problem, setProblem] = useState<'reference' | undefined>();
  if (loan === undefined) return null;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || loan === undefined) return;
    const reference = formText(new FormData(e.currentTarget), 'reference').trim();
    const wrong = reference !== '' && !LOAN_REFERENCE.test(reference) ? 'reference' : undefined;
    setProblem(wrong);
    if (wrong !== undefined) return;
    run(
      { entityId: view.entityId, loanId: loan.id, ...(reference === '' ? {} : { reference }) },
      () => {
        onSaved(t('disburse.saved'));
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('disburse.title')}</DialogTitle>
        <DialogDescription>{t('disburse.intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="loan-disburse-reference"
        label={t('create.reference')}
        helper={t('create.referenceHelper')}
        error={problem === 'reference' ? t('create.referenceInvalid') : fieldError('reference')}
      >
        <Input
          name="reference"
          autoComplete="off"
          maxLength={60}
          defaultValue={loan.reference ?? ''}
        />
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer pending={pending} submit={t('disburse.submit')} onClose={onClose} />
    </form>
  );
}

function RejectForm({ view, loan, onClose, onSaved }: FormProps) {
  const t = useTranslations('loans');
  const { run, pending, failure } = useCommand(rejectLoan);
  const { fieldError, formFailure } = useFieldFailure(failure, ['reason']);
  if (loan === undefined) return null;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || loan === undefined) return;
    const reason = formText(new FormData(e.currentTarget), 'reason').trim();
    run({ entityId: view.entityId, loanId: loan.id, reason }, () => {
      onSaved(t('reject.saved'));
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('reject.title')}</DialogTitle>
        <DialogDescription>{t('reject.intro')}</DialogDescription>
      </DialogHeader>
      <Field id="loan-reject-reason" label={t('reject.reason')} error={fieldError('reason')}>
        <Textarea name="reason" maxLength={300} rows={3} required />
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer pending={pending} submit={t('reject.submit')} onClose={onClose} danger />
    </form>
  );
}
