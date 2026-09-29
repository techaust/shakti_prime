'use client';

import type { Segment } from '@shakti/contracts';
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
  Select,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { setCompositeRule } from '../../actions/tax';
import { percentFromTyped } from '../../screens/catalogue';
import { SEGMENTS } from '../../screens/contract-values';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

const FIELDS = [
  'segment',
  'goodsSharePct',
  'servicesSharePct',
  'goodsRatePct',
  'servicesRatePct',
  'effectiveFrom',
  'effectiveTo',
] as const;

const PERCENTS = ['goodsSharePct', 'servicesSharePct', 'goodsRatePct', 'servicesRatePct'] as const;
type PercentField = (typeof PERCENTS)[number];
type Problem = PercentField | 'shares' | 'from' | 'to';

/** Adds the goods and services split of a composite supply for a business line (`tax.composite.set`). */
export function RuleDialog({
  returnFocusTo,
  onClose,
  onSaved,
}: {
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('taxSettings.ruleDialog');
  const activity = useTranslations('activity');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setCompositeRule);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [problems, setProblems] = useState<ReadonlySet<Problem>>(new Set());
  const [toText, setToText] = useState('');

  const labels: Record<PercentField, string> = {
    goodsSharePct: t('goodsShare'),
    servicesSharePct: t('servicesShare'),
    goodsRatePct: t('goodsRate'),
    servicesRatePct: t('servicesRate'),
  };

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const found = new Set<Problem>();
    const values: Partial<Record<PercentField, string>> = {};
    for (const f of PERCENTS) {
      const value = percentFromTyped(formText(data, f));
      if (value === undefined) found.add(f);
      else values[f] = value;
    }
    const { goodsSharePct, servicesSharePct, goodsRatePct, servicesRatePct } = values;
    if (
      goodsSharePct !== undefined &&
      servicesSharePct !== undefined &&
      Math.round(Number(goodsSharePct) * 100) + Math.round(Number(servicesSharePct) * 100) !==
        10_000
    ) {
      found.add('shares');
    }
    const effectiveFrom = formText(data, 'effectiveFrom');
    const effectiveTo = formText(data, 'effectiveTo');
    if (effectiveFrom === '') found.add('from');
    if (toText.trim() !== '' && effectiveTo === '') found.add('to');
    setProblems(found);
    if (
      found.size > 0 ||
      goodsSharePct === undefined ||
      servicesSharePct === undefined ||
      goodsRatePct === undefined ||
      servicesRatePct === undefined
    ) {
      return;
    }
    run(
      {
        segment: formText(data, 'segment') as Segment,
        goodsSharePct,
        servicesSharePct,
        goodsRatePct,
        servicesRatePct,
        effectiveFrom,
        ...(effectiveTo === '' ? {} : { effectiveTo }),
      },
      () => {
        toast.success(t('done'));
        onSaved();
      },
    );
  }

  const percentError = (f: PercentField) => {
    if (problems.has(f)) return t('percentWrong');
    if (f === 'servicesSharePct' && problems.has('shares')) return t('sharesWrong');
    return fieldError(f);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        closeLabel={common('close')}
        returnFocusTo={returnFocusTo}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
            <DialogDescription>{t('intro')}</DialogDescription>
          </DialogHeader>
          <Field id="rule-segment" label={t('segment')} error={fieldError('segment')}>
            <Select name="segment" defaultValue={SEGMENTS[0]}>
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {activity(`values.segment.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            {PERCENTS.map((f) => (
              <Field
                key={f}
                id={`rule-${f}`}
                label={labels[f]}
                helper={f.endsWith('SharePct') ? t('shareHelper') : undefined}
                error={percentError(f)}
              >
                <Input
                  name={f}
                  inputMode="decimal"
                  maxLength={6}
                  autoComplete="off"
                  className="tabular-nums"
                />
              </Field>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="rule-from"
              label={t('from')}
              error={problems.has('from') ? t('dateWrong') : fieldError('effectiveFrom')}
            >
              <DateInput name="effectiveFrom" />
            </Field>
            <Field
              id="rule-to"
              label={t('to')}
              helper={t('toHelper')}
              error={problems.has('to') ? t('dateWrong') : fieldError('effectiveTo')}
            >
              <DateInput
                name="effectiveTo"
                onValueChange={(_iso, text) => {
                  setToText(text);
                }}
              />
            </Field>
          </div>
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
      </DialogContent>
    </Dialog>
  );
}
