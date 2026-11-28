'use client';

import type { AccountLoanRowDto } from '@shakti/contracts';
import { StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatDate, formatRupees } from '../../screens/format';
import { LOAN_STATE_TONE } from '../../screens/loans';
import { orderHref } from '../../screens/orders';

/**
 * Account 360's loans (docs/03-roadmap-appendix/phase4.md §6.2): the customer's loans in this
 * company, newest first, each with its lender, amount, status and order; a loan is recorded and
 * moved on from its order's Loan tab.
 */
export function AccountLoans({ loans }: { loans: readonly AccountLoanRowDto[] }) {
  const t = useTranslations('loans');
  return (
    <section
      aria-labelledby="account-loans"
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="account-loans" className="text-h3">
        {t('account.sectionTitle')}
      </h2>
      {loans.length === 0 ? (
        <p className="text-text-muted">{t('account.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {loans.map((loan) => (
            <li key={loan.id} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {loan.soNo === null ? (
                  <span className="text-text-muted">{t('account.orderHidden')}</span>
                ) : (
                  <Link
                    href={orderHref(loan.entityId, loan.salesOrderId)}
                    className="text-accent-text font-medium tabular-nums hover:underline"
                  >
                    {t('account.order', { number: loan.soNo })}
                  </Link>
                )}
                <StatusBadge tone={LOAN_STATE_TONE[loan.state]}>
                  {t(`state.${loan.state}`)}
                </StatusBadge>
              </div>
              <span className="text-text-muted text-sm tabular-nums">
                {t('account.summary', {
                  lender: loan.lenderName,
                  amount: formatRupees(loan.sanctionedAmount ?? loan.amount),
                })}
                {' · '}
                <time dateTime={loan.stateChangedAt}>{formatDate(loan.stateChangedAt)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
