'use client';

import type {
  BoardLeadDto,
  LeadAssigneeDto,
  OpportunityDto,
  PipelineStageDto,
} from '@shakti/contracts';
import {
  Button,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  assignOpportunity,
  listLeadAssignees,
  loseOpportunity,
  nurtureOpportunity,
  reopenOpportunity,
  winOpportunity,
  moveOpportunityStage,
} from '../../actions/crm';
import {
  OPPORTUNITY_LOST_REASONS,
  OPPORTUNITY_NURTURE_REASONS,
} from '../../screens/contract-values';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

/** What every board dialog is given: the lead, and what to do when it is done or cancelled. */
interface DialogProps {
  lead: BoardLeadDto;
  onDone: (changed: OpportunityDto, ownerName?: string) => void;
  onCancel: () => void;
}

const target = (lead: BoardLeadDto) => ({ entityId: lead.entityId, opportunityId: lead.id });

/** The buttons under a dialog's form: cancel, and the one action. */
function Footer({
  onCancel,
  pending,
  danger = false,
  disabled = false,
  children,
}: {
  onCancel: () => void;
  pending: boolean;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const common = useTranslations('common');
  return (
    <DialogFooter>
      <Button variant="secondary" onClick={onCancel}>
        {common('cancel')}
      </Button>
      <Button
        type="submit"
        variant={danger ? 'danger' : 'primary'}
        pending={pending}
        disabled={disabled}
      >
        {children}
      </Button>
    </DialogFooter>
  );
}

/** Move to…: another open stage of the lead's pipeline (`crm.opportunity.stage.move`). */
export function MoveForm({
  lead,
  stages,
  onDone,
  onCancel,
}: DialogProps & {
  stages: readonly PipelineStageDto[];
}) {
  const t = useTranslations('leads.board.moveDialog');
  const { run, pending, failure } = useCommand(moveOpportunityStage);
  const { fieldError, formFailure } = useFieldFailure(failure, ['stageId']);
  const choices = stages.filter((s) => s.kind === 'open' && s.id !== lead.stageId);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const stageId = formText(new FormData(e.currentTarget), 'stageId');
    if (stageId === '') return;
    run({ ...target(lead), stageId }, onDone);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name: lead.customerName })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      {choices.length === 0 ? (
        <p className="text-text-muted">{t('noStage')}</p>
      ) : (
        <Field id="board-move-stage" label={t('stage')} error={fieldError('stageId')}>
          <Select name="stageId" defaultValue={choices[0]?.id}>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending} disabled={choices.length === 0}>
        {t('submit')}
      </Footer>
    </form>
  );
}

/** Assign: to a person who works on leads in the lead's company (`crm.opportunity.assign`). */
export function AssignForm({ lead, onDone, onCancel }: DialogProps) {
  const t = useTranslations('leads.board.assignDialog');
  const board = useTranslations('leads.board');
  const { run, pending, failure } = useCommand(assignOpportunity);
  const { fieldError, formFailure } = useFieldFailure(failure, ['ownerId']);
  const people = useQuery<LeadAssigneeDto[]>();
  const loadPeople = people.load;
  const [choices, setChoices] = useState<LeadAssigneeDto[] | undefined>();
  const [needsPerson, setNeedsPerson] = useState(false);

  useEffect(() => {
    loadPeople(() => listLeadAssignees({ entityId: lead.entityId }), setChoices);
  }, [loadPeople, lead.entityId]);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const ownerId = formText(new FormData(e.currentTarget), 'ownerId');
    setNeedsPerson(ownerId === '');
    if (ownerId === '') return;
    const name = choices?.find((p) => p.id === ownerId)?.name;
    run({ ...target(lead), ownerId }, (changed) => {
      onDone(changed, name);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name: lead.customerName })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      {choices === undefined ? (
        people.failure === undefined ? (
          <p className="text-text-muted" role="status">
            {t('loading')}
          </p>
        ) : (
          <FailureMessage failure={people.failure} />
        )
      ) : choices.length === 0 ? (
        <p className="text-text-muted">{t('none')}</p>
      ) : (
        <Field
          id="board-assign-person"
          label={t('person')}
          error={needsPerson ? t('needPerson') : fieldError('ownerId')}
        >
          <Select name="ownerId" defaultValue="">
            <option value="" disabled>
              {board('choose')}
            </option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <FailureMessage failure={formFailure} />
      <Footer
        onCancel={onCancel}
        pending={pending}
        disabled={choices === undefined || choices.length === 0}
      >
        {t('submit')}
      </Footer>
    </form>
  );
}

/** A reason picked from a fixed list: parking a lead or losing it. */
function ReasonForm({ lead, onDone, onCancel, kind }: DialogProps & { kind: 'nurture' | 'lose' }) {
  const t = useTranslations(
    kind === 'nurture' ? 'leads.board.nurtureDialog' : 'leads.board.loseDialog',
  );
  const board = useTranslations('leads.board');
  const { run, pending, failure } = useCommand(
    kind === 'nurture' ? nurtureOpportunity : loseOpportunity,
  );
  const { fieldError, formFailure } = useFieldFailure(failure, ['reasonCode']);
  const [needsReason, setNeedsReason] = useState(false);
  const reasons =
    kind === 'nurture'
      ? OPPORTUNITY_NURTURE_REASONS.map((code) => ({
          code,
          label: board(`nurtureReason.${code}`),
        }))
      : OPPORTUNITY_LOST_REASONS.map((code) => ({
          code,
          label: board(`lostReason.${code}`),
        }));

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const reasonCode = formText(new FormData(e.currentTarget), 'reasonCode');
    setNeedsReason(reasonCode === '');
    if (reasonCode === '') return;
    run({ ...target(lead), reasonCode }, onDone);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name: lead.customerName })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id={`board-${kind}-reason`}
        label={t('reason')}
        error={needsReason ? t('needReason') : fieldError('reasonCode')}
      >
        <Select name="reasonCode" defaultValue="">
          <option value="" disabled>
            {board('choose')}
          </option>
          {reasons.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <FailureMessage failure={formFailure} />
      <Footer onCancel={onCancel} pending={pending} danger={kind === 'lose'}>
        {t('submit')}
      </Footer>
    </form>
  );
}

/** Follow up later (`crm.opportunity.nurture`), with the reason. */
export function NurtureForm(props: DialogProps) {
  return <ReasonForm {...props} kind="nurture" />;
}

/** Mark as lost (`crm.opportunity.lose`), with the reason code. */
export function LoseForm(props: DialogProps) {
  return <ReasonForm {...props} kind="lose" />;
}

/**
 * A confirmation with one action on the lead: reopen it, or mark it won. Win is offered on every
 * open lead; until quotes and orders exist, its answer is the sentence that says why not.
 */
export function ConfirmForm({
  lead,
  onDone,
  onCancel,
  kind,
}: DialogProps & { kind: 'reopen' | 'win' }) {
  const t = useTranslations(
    kind === 'reopen' ? 'leads.board.reopenDialog' : 'leads.board.winDialog',
  );
  const { run, pending, failure } = useCommand(
    kind === 'reopen' ? reopenOpportunity : winOpportunity,
  );

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    run(target(lead), onDone);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{t('title', { name: lead.customerName })}</DialogTitle>
        <DialogDescription>{t('intro')}</DialogDescription>
      </DialogHeader>
      <FailureMessage failure={failure} />
      <Footer onCancel={onCancel} pending={pending}>
        {t('submit')}
      </Footer>
    </form>
  );
}
