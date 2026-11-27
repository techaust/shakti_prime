'use client';

import type {
  MilestoneDueRule,
  MilestoneLoanGate,
  MilestoneStep,
  Segment,
} from '@shakti/contracts';
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
import { publishPaymentTerms } from '../../actions/finance';
import {
  MILESTONE_DUE_DAYS_MAX,
  MILESTONE_DUE_RULES,
  MILESTONE_LABEL_MAX,
  MILESTONE_LOAN_GATES,
  MILESTONE_STEPS_MAX,
} from '../../screens/contract-values';
import { percentTotal, stepKeys, twoDecimals } from '../../screens/finance';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

/** One payment as the form holds it, typed values kept as text until it is sent. */
interface Row {
  id: number;
  label: string;
  kind: 'percent' | 'amount';
  value: string;
  dueRule: MilestoneDueRule;
  dueDays: string;
  loanGate: MilestoneLoanGate;
}

function rowsOf(steps: readonly MilestoneStep[]): Row[] {
  return steps.map((step, index) => ({
    id: index,
    label: step.label,
    kind: step.percent === null ? 'amount' : 'percent',
    value: step.percent ?? step.amount ?? '',
    dueRule: step.dueRule,
    dueDays: step.dueDays === null ? '' : String(step.dueDays),
    loanGate: step.loanGate,
  }));
}

/**
 * The payments of a new version of the terms, as `MilestoneStepsSchema` takes them; undefined when
 * a figure is not a number, which the form then names. The keys come from the names.
 */
function stepsOf(rows: readonly Row[]): MilestoneStep[] | undefined {
  const keys = stepKeys(rows.map((r) => r.label));
  const steps: MilestoneStep[] = [];
  for (const [index, row] of rows.entries()) {
    const figure = twoDecimals(row.value);
    if (figure === null) return undefined;
    const days = row.dueRule === 'days_after_invoice' ? Number(row.dueDays) : null;
    if (days !== null && !Number.isInteger(days)) return undefined;
    steps.push({
      key: keys[index] ?? `payment_${String(index + 1)}`,
      label: row.label.trim(),
      percent: row.kind === 'percent' ? figure : null,
      amount: row.kind === 'amount' ? figure : null,
      dueRule: row.dueRule,
      dueDays: days,
      loanGate: row.loanGate,
    });
  }
  return steps;
}

/**
 * The Executive's form for a new version of one company's terms for one kind of order
 * (`finance.terms.publish`): the payments in the order the customer makes them, each a
 * percentage or a fixed amount, when it falls due and whether it waits for a customer loan. The
 * percentages' total is shown as they are typed; the server checks every rule again.
 */
export function TermsEditor({
  entityId,
  segment,
  initial,
  onClose,
  onDone,
}: {
  entityId: number;
  segment: Segment;
  initial: readonly MilestoneStep[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations('finance');
  const common = useTranslations('common');
  const [rows, setRows] = useState<Row[]>(() => rowsOf(initial));
  const [nextId, setNextId] = useState(initial.length);
  const [invalid, setInvalid] = useState(false);
  const publish = useCommand(publishPaymentTerms);
  const total = percentTotal(rows.filter((r) => r.kind === 'percent').map((r) => r.value));
  const totalText = (total / 100).toFixed(2).replace(/\.00$/, '');

  const change = (id: number, patch: Partial<Row>) => {
    setRows((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (publish.pending) return;
    const steps = stepsOf(rows);
    if (steps === undefined || total !== 10000) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    publish.run({ entityId, segment, steps }, onDone);
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent closeLabel={common('close')} className="max-w-3xl">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('terms.editTitle')}</DialogTitle>
            <DialogDescription>
              {t('terms.editIntro')} {t(`terms.segments.${segment}`)}
            </DialogDescription>
          </DialogHeader>
          <ol className="flex flex-col gap-3" aria-label={t('terms.stepsCaption')}>
            {rows.map((row, index) => (
              <li key={row.id} className="border-border flex flex-col gap-3 rounded-lg border p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id={`step-${String(row.id)}-label`} label={t('terms.label')}>
                    <Input
                      value={row.label}
                      maxLength={MILESTONE_LABEL_MAX}
                      required
                      onChange={(e) => {
                        change(row.id, { label: e.target.value });
                      }}
                    />
                  </Field>
                  <Field id={`step-${String(row.id)}-kind`} label={t('terms.kind')}>
                    <Select
                      value={row.kind}
                      onChange={(e) => {
                        change(row.id, { kind: e.target.value as Row['kind'] });
                      }}
                    >
                      <option value="percent">{t('terms.kindPercent')}</option>
                      <option value="amount">{t('terms.kindAmount')}</option>
                    </Select>
                  </Field>
                  <Field id={`step-${String(row.id)}-value`} label={t('terms.value')}>
                    <Input
                      value={row.value}
                      inputMode="decimal"
                      required
                      onChange={(e) => {
                        change(row.id, { value: e.target.value });
                      }}
                    />
                  </Field>
                  <Field id={`step-${String(row.id)}-due`} label={t('terms.dueRule')}>
                    <Select
                      value={row.dueRule}
                      onChange={(e) => {
                        change(row.id, { dueRule: e.target.value as MilestoneDueRule });
                      }}
                    >
                      {MILESTONE_DUE_RULES.map((rule) => (
                        <option key={rule} value={rule}>
                          {t(`terms.dueRules.${rule}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {row.dueRule === 'days_after_invoice' ? (
                    <Field id={`step-${String(row.id)}-days`} label={t('terms.dueDays')}>
                      <Input
                        value={row.dueDays}
                        inputMode="numeric"
                        min={1}
                        max={MILESTONE_DUE_DAYS_MAX}
                        required
                        onChange={(e) => {
                          change(row.id, { dueDays: e.target.value });
                        }}
                      />
                    </Field>
                  ) : null}
                  <Field id={`step-${String(row.id)}-loan`} label={t('terms.loanGate')}>
                    <Select
                      value={row.loanGate}
                      onChange={(e) => {
                        change(row.id, { loanGate: e.target.value as MilestoneLoanGate });
                      }}
                    >
                      {MILESTONE_LOAN_GATES.map((gate) => (
                        <option key={gate} value={gate}>
                          {t(`loanGate.${gate}`)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                {rows.length > 1 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    aria-label={t('terms.removeNamed', { number: index + 1 })}
                    onClick={() => {
                      setRows((current) => current.filter((r) => r.id !== row.id));
                    }}
                  >
                    {t('terms.remove')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ol>
          {rows.length < MILESTONE_STEPS_MAX ? (
            <Button
              variant="secondary"
              className="self-start"
              onClick={() => {
                setRows((current) => [
                  ...current,
                  {
                    id: nextId,
                    label: '',
                    kind: 'percent',
                    value: '',
                    dueRule: 'before_dispatch',
                    dueDays: '',
                    loanGate: 'none',
                  },
                ]);
                setNextId((n) => n + 1);
              }}
            >
              {t('terms.addStep')}
            </Button>
          ) : null}
          <p role="status" className={total === 10000 ? 'text-text-muted' : 'text-warning'}>
            {total === 10000
              ? t('terms.percentTotal', { total: totalText })
              : t('terms.percentTotalWrong', { total: totalText })}
          </p>
          {invalid ? (
            <p role="alert" className="text-danger">
              {t('terms.stepsInvalid')}
            </p>
          ) : null}
          <FailureMessage failure={publish.failure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={publish.pending}>
              {t('terms.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
