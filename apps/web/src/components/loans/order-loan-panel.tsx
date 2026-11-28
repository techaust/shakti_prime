'use client';

import type { CustomerLoanDto, OrderLoansDto } from '@shakti/contracts';
import { Button, StatusBadge, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';
import { getOrderLoans } from '../../actions/loans';
import { ACTIVE_LOAN_STATE_VALUES } from '../../screens/contract-values';
import { formatDateTime, formatRupees } from '../../screens/format';
import { LOAN_GATE_TONE, LOAN_STATE_TONE } from '../../screens/loans';
import { FailureMessage } from '../screens/failure';
import type { CommandFailure } from '../screens/use-command';
import { settle } from '../screens/settle';
import type { LoanDialogKind } from './loan-dialogs';

/** The dialogs load on first use, so the order page carries none of their code until then. */
const LoanDialog = dynamic(() => import('./loan-dialogs').then((m) => m.LoanDialog));

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

/** The order's one active loan, if it has one (applied, sanctioned or paid out). */
function activeLoan(loans: readonly CustomerLoanDto[]): CustomerLoanDto | undefined {
  return loans.find((l) => (ACTIVE_LOAN_STATE_VALUES as readonly string[]).includes(l.state));
}

/**
 * The order's Loan tab (docs/03-roadmap-appendix/phase4.md §6.2, PRD CRM-08): whether the dispatch
 * waits for the customer's loan, the active loan with its lender, amounts and dates, and the moves
 * a person who looks after the customer may record (sanction, payout, turn-down), each through its
 * command; then the tab reads the order's loans and gate again. Loans the lender turned down are
 * listed below, with the reason. While a turned-down loan still holds the dispatch, a person who
 * writes customers across the company may record that the order no longer waits for a loan.
 */
export function OrderLoanPanel({ initial }: { initial: OrderLoansDto }) {
  const t = useTranslations('loans');
  const [view, setView] = useState(initial);
  const [dialog, setDialog] = useState<LoanDialogKind | undefined>();
  const [failure, setFailure] = useState<CommandFailure | undefined>();
  const active = activeLoan(view.loans);
  const earlier = view.loans.filter((l) => l !== active);
  // The turned-down loan that still holds the dispatch, until a new loan or a waiver.
  const heldBy =
    view.gate.reason === 'loan_rejected'
      ? view.loans.find((l) => l.id === view.gate.loanId)
      : undefined;

  async function reload(saved: string) {
    setDialog(undefined);
    toast.success(saved);
    const result = await settle(() =>
      getOrderLoans({ entityId: view.entityId, orderId: view.orderId }),
    );
    if (result.ok) {
      setView(result.data);
      setFailure(undefined);
    } else {
      setFailure((previous) => ({
        error: result.error,
        reference: result.reference,
        attempt: (previous?.attempt ?? 0) + 1,
      }));
    }
  }

  const open = (kind: LoanDialogKind) => () => {
    setDialog(kind);
  };

  return (
    <section
      aria-labelledby="order-loan"
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="order-loan" className="text-h3">
          {t('tab.title')}
        </h2>
        {view.canWrite && active === undefined ? (
          <Button size="sm" variant="secondary" onClick={open('create')}>
            {t('tab.recordLoan')}
          </Button>
        ) : null}
      </div>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={LOAN_GATE_TONE[view.gate.dispatch]}>
          {heldBy === undefined ? t(`gate.${view.gate.dispatch}Note`) : t('gate.turnedDownNote')}
        </StatusBadge>
      </p>
      {heldBy === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-text-muted text-sm">{t('tab.turnedDownHelp')}</p>
          {view.canWaive ? (
            <Button size="sm" variant="secondary" onClick={open('waive')}>
              {t('tab.stopWaiting')}
            </Button>
          ) : null}
        </div>
      )}
      <FailureMessage failure={failure} />
      {active === undefined ? (
        <p className="text-text-muted">{t('tab.empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Detail label={t('tab.lender')}>{active.lenderName}</Detail>
            <Detail label={t('tab.amount')}>
              <span className="tabular-nums">{formatRupees(active.amount)}</span>
            </Detail>
            <Detail label={t('tab.dispatchWaitsFor')}>
              {t(`dispatchGate.${active.gates.dispatch}`)}
            </Detail>
            <Detail label={t('tab.recordedOn')}>
              <time dateTime={active.createdAt}>{formatDateTime(active.createdAt)}</time>
            </Detail>
            {active.sanctionedAmount === null ? null : (
              <Detail label={t('tab.sanctionedAmount')}>
                <span className="tabular-nums">{formatRupees(active.sanctionedAmount)}</span>
              </Detail>
            )}
            {active.sanctionedAt === null ? null : (
              <Detail label={t('tab.sanctionedOn')}>
                <time dateTime={active.sanctionedAt}>{formatDateTime(active.sanctionedAt)}</time>
              </Detail>
            )}
            {active.disbursedAt === null ? null : (
              <Detail label={t('tab.paidOutOn')}>
                <time dateTime={active.disbursedAt}>{formatDateTime(active.disbursedAt)}</time>
              </Detail>
            )}
            {active.reference === null ? null : (
              <Detail label={t('tab.reference')}>{active.reference}</Detail>
            )}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={LOAN_STATE_TONE[active.state]}>
              {t(`state.${active.state}`)}
            </StatusBadge>
            {view.canWrite && active.state === 'applied' ? (
              <Button size="sm" onClick={open('sanction')}>
                {t('tab.recordSanction')}
              </Button>
            ) : null}
            {view.canWrite && active.state === 'sanctioned' ? (
              <Button size="sm" onClick={open('disburse')}>
                {t('tab.recordPayout')}
              </Button>
            ) : null}
            {view.canWrite && (active.state === 'applied' || active.state === 'sanctioned') ? (
              <Button size="sm" variant="secondary" onClick={open('reject')}>
                {t('tab.recordTurnDown')}
              </Button>
            ) : null}
          </div>
        </div>
      )}
      {!view.canWrite && active !== undefined && active.state !== 'disbursed' ? (
        <p className="text-text-muted text-sm">{t('tab.readOnly')}</p>
      ) : null}
      {earlier.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{t('tab.earlier')}</h3>
          <ul className="flex flex-col gap-2">
            {earlier.map((loan) => (
              <li key={loan.id} className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span>{loan.lenderName}</span>
                  <span className="tabular-nums">{formatRupees(loan.amount)}</span>
                  <StatusBadge tone={LOAN_STATE_TONE[loan.state]}>
                    {t(`state.${loan.state}`)}
                  </StatusBadge>
                </span>
                {loan.rejectedReason === null ? null : (
                  <span className="text-text-muted text-sm">
                    {t('tab.turnedDownBecause', { reason: loan.rejectedReason })}
                  </span>
                )}
                {loan.gatesWaivedReason === null ? null : (
                  <span className="text-text-muted text-sm">
                    {t('tab.waivedBecause', { reason: loan.gatesWaivedReason })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dialog === undefined ? null : (
        <LoanDialog
          kind={dialog}
          view={view}
          loan={dialog === 'waive' ? heldBy : active}
          onClose={() => {
            setDialog(undefined);
          }}
          onSaved={(saved) => {
            void reload(saved);
          }}
        />
      )}
    </section>
  );
}
