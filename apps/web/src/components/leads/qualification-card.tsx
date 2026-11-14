'use client';

import type { LeadQualificationDto, LeadQualificationFact } from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Skeleton,
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import { leadQualification, setLeadQualification } from '../../actions/lead-sources';
import { LEAD_QUALIFICATION_FACTS } from '../../screens/contract-values';
import { formatCount } from '../../screens/format';
import { qualificationInput } from '../../screens/lead-sources';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

/**
 * The qualification card on a lead (docs/03-roadmap-appendix/phase2.md §6.2): the facts a lead
 * carries (pump depth, the power needed, the monthly bill, the roof area, the sanctioned load, the
 * electricity consumer number), as a form or a caller recorded them, and a form to change them for
 * whoever may write the lead. An empty box clears its fact. Shown on the leads board, in the
 * Converting workspace and on Account 360's leads.
 */
export function QualificationCard({
  entityId,
  opportunityId,
  canWrite,
}: {
  entityId: number;
  opportunityId: string;
  canWrite: boolean;
}) {
  const t = useTranslations('qualification');
  const { load, failure: readFailure } = useQuery<LeadQualificationDto>();
  const [facts, setFacts] = useState<LeadQualificationDto | undefined>();
  const [editing, setEditing] = useState(false);
  const headingId = useId();

  useEffect(() => {
    load(() => leadQualification({ entityId, opportunityId }), setFacts);
  }, [entityId, opportunityId, load]);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-h3">
          {t('heading')}
        </h3>
        {canWrite && facts !== undefined && !editing ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('edit')}
          </Button>
        ) : null}
      </div>
      {facts === undefined ? (
        readFailure === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <FailureMessage failure={readFailure} />
        )
      ) : editing ? (
        <QualificationForm
          facts={facts}
          onSaved={(saved) => {
            setFacts(saved);
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      ) : (
        <FactList facts={facts} />
      )}
    </section>
  );
}

function shown(fact: LeadQualificationFact, facts: LeadQualificationDto): string | undefined {
  const value = facts[fact];
  if (value === null) return undefined;
  return typeof value === 'number' ? formatCount(value) : value;
}

function FactList({ facts }: { facts: LeadQualificationDto }) {
  const t = useTranslations('qualification');
  const recorded = LEAD_QUALIFICATION_FACTS.filter((f) => facts[f] !== null);
  if (recorded.length === 0) {
    return <p className="text-text-muted text-sm">{t('none')}</p>;
  }
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {recorded.map((fact) => (
        <div key={fact} className="flex flex-col">
          <dt className="text-text-muted text-sm">{t(`facts.${fact}`)}</dt>
          <dd className="tabular-nums">{shown(fact, facts)}</dd>
        </div>
      ))}
    </dl>
  );
}

const NUMBER_LIMITS: Record<
  Exclude<LeadQualificationFact, 'discomConsumerNo'>,
  { max: number; step: string }
> = {
  pumpDepthFt: { max: 5000, step: '1' },
  requiredHp: { max: 500, step: '0.5' },
  monthlyBillRupees: { max: 100_000_000, step: '1' },
  roofAreaSqFt: { max: 10_000_000, step: '1' },
  sanctionedLoadKw: { max: 100_000, step: '0.1' },
};

function QualificationForm({
  facts,
  onSaved,
  onCancel,
}: {
  facts: LeadQualificationDto;
  onSaved: (saved: LeadQualificationDto) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('qualification');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(setLeadQualification, facts.opportunityId);
  const { fieldError, formFailure } = useFieldFailure(
    failure,
    LEAD_QUALIFICATION_FACTS.map((f) => `facts.${f}`),
  );
  const id = useId();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    run(
      qualificationInput(facts, (name) => formText(data, name)),
      (saved) => {
        toast.success(t('saved'));
        onSaved(saved);
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {LEAD_QUALIFICATION_FACTS.map((fact) => {
          const value = facts[fact];
          const current = value === null ? '' : String(value);
          return (
            <Field
              key={fact}
              id={`${id}-${fact}`}
              label={t(`facts.${fact}`)}
              error={fieldError(`facts.${fact}`)}
            >
              {fact === 'discomConsumerNo' ? (
                <Input
                  name={fact}
                  defaultValue={current}
                  maxLength={30}
                  autoComplete="off"
                  spellCheck={false}
                />
              ) : (
                <Input
                  name={fact}
                  type="number"
                  inputMode="decimal"
                  autoComplete="off"
                  defaultValue={current}
                  min={0}
                  max={NUMBER_LIMITS[fact].max}
                  step={NUMBER_LIMITS[fact].step}
                />
              )}
            </Field>
          );
        })}
      </div>
      <FailureMessage failure={formFailure} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={pending}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}

/** The card in a dialog, for the leads board's card menu. */
export function QualificationDialog({
  entityId,
  opportunityId,
  name,
  canWrite,
  closeLabel,
  returnFocusTo,
  onClose,
}: {
  entityId: number;
  opportunityId: string;
  name: string;
  canWrite: boolean;
  closeLabel: string;
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
}) {
  const t = useTranslations('qualification');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={closeLabel} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle', { name })}</DialogTitle>
          <DialogDescription>{t('dialogIntro')}</DialogDescription>
        </DialogHeader>
        <QualificationCard entityId={entityId} opportunityId={opportunityId} canWrite={canWrite} />
      </DialogContent>
    </Dialog>
  );
}
