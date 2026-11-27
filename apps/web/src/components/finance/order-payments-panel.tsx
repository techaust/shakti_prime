'use client';

import type { OrderPaymentsDto, PaymentMilestoneDto, ProformaDto } from '@shakti/contracts';
import { Button, StatusBadge, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { getOrderPayments, issueProforma, planMilestones } from '../../actions/finance';
import { formatDate, formatDateTime, formatRupees } from '../../screens/format';
import { MILESTONE_STATE_TONE, milestoneOpen, PROFORMA_STATE_TONE } from '../../screens/finance';
import { useOpenFile } from '../files/use-open-file';
import { FailureMessage } from '../screens/failure';
import { settle } from '../screens/settle';
import { useCommand, type CommandFailure } from '../screens/use-command';
import type { PaymentDialogTarget } from './payment-dialogs';
import { RowsTable } from './rows-table';

/** The reason dialogs load on first use, so the order page carries none of their code until then. */
const PaymentDialog = dynamic(() => import('./payment-dialogs').then((m) => m.PaymentDialog));

/**
 * The order's Payments tab (docs/03-roadmap-appendix/phase5.md §6.1, PRD FIN-01): whether the
 * dispatch waits for a payment, the order's payments as its terms planned them, each with its
 * state, and its proformas with their PDFs. Accounts issue and cancel a proforma and plan the
 * payments of an order the platform has not planned; the Executive waives a payment still
 * waiting for money. Every amount is the server's; nothing is added up here.
 */
export function OrderPaymentsPanel({ initial }: { initial: OrderPaymentsDto }) {
  const t = useTranslations('finance');
  const [view, setView] = useState(initial);
  const [dialog, setDialog] = useState<PaymentDialogTarget | undefined>();
  const [failure, setFailure] = useState<CommandFailure | undefined>();
  const issue = useCommand(issueProforma);
  const plan = useCommand(planMilestones);
  const pdf = useOpenFile();
  const ref = { entityId: view.entityId, orderId: view.orderId };

  async function reload(saved: string) {
    setDialog(undefined);
    toast.success(saved);
    const result = await settle(() => getOrderPayments(ref));
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

  return (
    <section
      aria-labelledby="order-payments"
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="order-payments" className="text-h3">
          {t('tab.title')}
        </h2>
        <div className="flex flex-wrap gap-2">
          {view.canPlan ? (
            <Button
              size="sm"
              variant="secondary"
              pending={plan.pending}
              onClick={() => {
                plan.run(ref, () => void reload(t('tab.planned')));
              }}
            >
              {t('tab.plan')}
            </Button>
          ) : null}
          {view.canIssue ? (
            <Button
              size="sm"
              pending={issue.pending}
              onClick={() => {
                issue.run(ref, () => void reload(t('tab.issued')));
              }}
            >
              {t('tab.issue')}
            </Button>
          ) : null}
        </div>
      </div>
      {view.milestones.length === 0 ? null : (
        <p>
          <StatusBadge tone={view.dispatchGate === 'open' ? 'warning' : 'success'}>
            {view.dispatchGate === 'open' ? t('tab.dispatchOpen') : t('tab.dispatchClear')}
          </StatusBadge>
        </p>
      )}
      <FailureMessage failure={issue.failure ?? plan.failure ?? pdf.failure ?? failure} />

      {view.milestones.length === 0 ? (
        <p className="text-text-muted">
          {view.canPlan ? t('tab.notPlannedConfirmed') : t('tab.notPlanned')}
        </p>
      ) : (
        <Milestones
          milestones={view.milestones}
          canWaive={view.canWaive}
          onWaive={(milestone) => {
            setDialog({ kind: 'waive', milestone });
          }}
        />
      )}

      <h3 className="text-h4">{t('tab.proformasHeading')}</h3>
      {view.proformas.length === 0 ? (
        <p className="text-text-muted">{t('tab.noProformas')}</p>
      ) : (
        <RowsTable
          caption={t('tab.proformasCaption')}
          titleLabel={t('tab.columns.number')}
          actionsLabel={t('tab.columns.actions')}
          columns={[
            { id: 'state', label: t('tab.columns.status') },
            { id: 'issued', label: t('tab.columns.issuedOn') },
            { id: 'by', label: t('tab.columns.issuedBy') },
            { id: 'total', label: t('tab.columns.total'), numeric: true },
          ]}
          rows={view.proformas.map((proforma) => ({
            key: proforma.id,
            title: <span className="tabular-nums">{proforma.proformaNo}</span>,
            cells: proformaCells(proforma, t),
            actions: (
              <ProformaActions
                proforma={proforma}
                canCancel={view.canCancelProforma}
                opening={pdf.opening}
                onOpen={(fileId) => {
                  pdf.open(fileId);
                }}
                onCancel={() => {
                  setDialog({ kind: 'cancel', proforma });
                }}
              />
            ),
          }))}
        />
      )}

      {dialog === undefined ? null : (
        <PaymentDialog
          target={dialog}
          onClose={() => {
            setDialog(undefined);
          }}
          onDone={(saved) => void reload(saved)}
        />
      )}
    </section>
  );
}

type FinanceT = ReturnType<typeof useTranslations<'finance'>>;

function proformaCells(proforma: ProformaDto, t: FinanceT) {
  return {
    state: (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge tone={PROFORMA_STATE_TONE[proforma.state]}>
          {t(`proformaState.${proforma.state}`)}
        </StatusBadge>
        {proforma.cancelReason === null ? null : (
          <span className="text-text-muted text-sm">
            {t('tab.cancelledBy', {
              name: proforma.cancelledByName ?? '',
              reason: proforma.cancelReason,
            })}
          </span>
        )}
      </span>
    ),
    issued: <time dateTime={proforma.issuedAt}>{formatDateTime(proforma.issuedAt)}</time>,
    by: proforma.issuedByName ?? '',
    total: formatRupees(proforma.totals.grandTotal),
  };
}

function ProformaActions({
  proforma,
  canCancel,
  opening,
  onOpen,
  onCancel,
}: {
  proforma: ProformaDto;
  canCancel: boolean;
  opening: boolean;
  onOpen: (fileId: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('finance.tab');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {proforma.pdfFileId === null ? (
        proforma.state === 'issued' ? (
          <p role="status" className="text-text-muted text-sm">
            {t('pdfWaiting')}
          </p>
        ) : null
      ) : (
        <Button
          size="sm"
          variant="secondary"
          pending={opening}
          onClick={() => {
            if (proforma.pdfFileId !== null) onOpen(proforma.pdfFileId);
          }}
        >
          {t('open')}
        </Button>
      )}
      {canCancel && proforma.state === 'issued' ? (
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('cancelProforma')}
        </Button>
      ) : null}
    </div>
  );
}

/** When a payment is due, in words: its rule, and the loan state it waits for. */
function dueText(milestone: PaymentMilestoneDto, t: FinanceT): string {
  const rule = t(`dueRule.${milestone.dueRule}`, { days: milestone.dueDays ?? 0 });
  return milestone.loanGate === 'none'
    ? rule
    : t('tab.waitsForLoan', { rule, state: milestone.loanGate });
}

function Milestones({
  milestones,
  canWaive,
  onWaive,
}: {
  milestones: PaymentMilestoneDto[];
  canWaive: boolean;
  onWaive: (milestone: PaymentMilestoneDto) => void;
}) {
  const t = useTranslations('finance');
  return (
    <RowsTable
      caption={t('tab.milestonesCaption')}
      titleLabel={t('tab.columns.payment')}
      actionsLabel={t('tab.columns.actions')}
      columns={[
        { id: 'state', label: t('tab.columns.status') },
        { id: 'share', label: t('tab.columns.share') },
        { id: 'amount', label: t('tab.columns.amount'), numeric: true },
        { id: 'paid', label: t('tab.columns.paid'), numeric: true },
        { id: 'due', label: t('tab.columns.due') },
        { id: 'dueOn', label: t('tab.columns.dueOn') },
      ]}
      rows={milestones.map((m) => ({
        key: m.id,
        title: m.label,
        cells: {
          state: (
            <span className="flex flex-col items-start gap-1">
              <StatusBadge tone={MILESTONE_STATE_TONE[m.state]}>
                {t(`state.${m.state}`)}
              </StatusBadge>
              {m.waiveReason === null ? null : (
                <span className="text-text-muted text-sm">
                  {t('tab.waivedBy', { name: m.waivedByName ?? '', reason: m.waiveReason })}
                </span>
              )}
            </span>
          ),
          share: m.percent === null ? t('tab.fixed') : t('tab.percent', { percent: m.percent }),
          amount: formatRupees(m.amount),
          paid: formatRupees(m.paidAmount),
          due: dueText(m, t),
          ...(m.dueOn === null ? {} : { dueOn: formatDate(m.dueOn) }),
        },
        ...(canWaive && milestoneOpen(m.state)
          ? {
              actions: (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    onWaive(m);
                  }}
                  aria-label={t('tab.waiveNamed', { payment: m.label })}
                >
                  {t('tab.waive')}
                </Button>
              ),
            }
          : {}),
      }))}
    />
  );
}
