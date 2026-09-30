'use client';

import type {
  PipelineSettingsDto,
  PipelineSettingsViewDto,
  StageSettingsDto,
} from '@shakti/contracts';
import { Button, Field, Input, StatusBadge, toast, useFocusTargets } from '@shakti/ui';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useState, type SyntheticEvent } from 'react';
import { createStage, reorderStages, updatePipeline } from '../../actions/crm-settings';
import {
  FIRST_CONTACT_SLA_MAX,
  LOCK_HOURS_MAX,
  PROTECTED_STAGE_KEYS,
} from '../../screens/contract-values';
import { moveItem, pipelineChanges, withStage } from '../../screens/pipeline-settings';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/** The stage dialogs, fetched when one is first opened. */
const StageDialog = dynamic(() => import('./stage-dialogs').then((m) => m.StageDialog));
const ArchiveStageDialog = dynamic(() =>
  import('./stage-dialogs').then((m) => m.ArchiveStageDialog),
);

const PIPELINE_FIELDS = ['name', 'lockHours', 'firstContactSlaMinutes'] as const;

/** Stages every pipeline keeps: they are renamed and moved, never archived. */
const KEPT: ReadonlySet<string> = new Set(PROTECTED_STAGE_KEYS);

/** One pipeline: its name and limits, then its stages in order with their actions. */
export function PipelineCard({
  initial,
  companyName,
}: {
  initial: PipelineSettingsViewDto;
  /** The company a pipeline of one company belongs to; undefined for a shared pipeline. */
  companyName: string | undefined;
}) {
  const t = useTranslations('pipelineSettings');
  const [pipeline, setPipeline] = useState(initial.pipeline);
  const [stages, setStages] = useState(initial.stages);
  const headingId = `pipeline-${pipeline.id}`;
  return (
    <article
      aria-labelledby={headingId}
      className="border-border bg-surface flex flex-col gap-5 rounded-xl border p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-h3">
          {pipeline.name}
        </h3>
        <StatusBadge tone="neutral">
          {companyName === undefined ? t('groupWide') : t('companyOnly', { company: companyName })}
        </StatusBadge>
      </div>
      <PipelineForm pipeline={pipeline} onSaved={setPipeline} />
      <StageList pipeline={pipeline} stages={stages} onChange={setStages} />
    </article>
  );
}

function PipelineForm({
  pipeline,
  onSaved,
}: {
  pipeline: PipelineSettingsDto;
  onSaved: (pipeline: PipelineSettingsDto) => void;
}) {
  const t = useTranslations('pipelineSettings');
  const { run, pending, failure } = useCommand(updatePipeline);
  const { fieldError, formFailure } = useFieldFailure(failure, PIPELINE_FIELDS);
  const id = (field: string) => `${pipeline.id}-${field}`;

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const changes = pipelineChanges(pipeline, {
      name: formText(data, 'name'),
      lockHours: formText(data, 'lockHours'),
      firstContactSlaMinutes: formText(data, 'firstContactSlaMinutes'),
    });
    // Nothing changed: nothing to record in the Activity log.
    if (changes === undefined) return;
    run({ pipelineId: pipeline.id, ...changes }, (saved) => {
      onSaved(saved);
      toast.success(t('pipelineSaved', { name: saved.name }));
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={id('name')} label={t('name')} error={fieldError('name')}>
          <Input
            name="name"
            defaultValue={pipeline.name}
            required
            minLength={2}
            maxLength={60}
            autoComplete="off"
          />
        </Field>
        <Field
          id={id('lock')}
          label={t('lockHours')}
          helper={t('lockHoursHelper')}
          error={fieldError('lockHours')}
        >
          <Input
            name="lockHours"
            type="number"
            inputMode="numeric"
            min={1}
            max={LOCK_HOURS_MAX}
            required
            defaultValue={String(pipeline.lockHours)}
          />
        </Field>
        <Field
          id={id('sla')}
          label={t('sla')}
          helper={t('slaHelper')}
          error={fieldError('firstContactSlaMinutes')}
        >
          <Input
            name="firstContactSlaMinutes"
            type="number"
            inputMode="numeric"
            min={1}
            max={FIRST_CONTACT_SLA_MAX}
            defaultValue={
              pipeline.firstContactSlaMinutes === null
                ? ''
                : String(pipeline.firstContactSlaMinutes)
            }
          />
        </Field>
      </div>
      <FailureMessage failure={formFailure} />
      <div className="flex justify-end">
        <Button type="submit" variant="secondary" pending={pending}>
          {t('savePipeline')}
        </Button>
      </div>
    </form>
  );
}

type Dialog = { kind: 'edit' | 'archive'; stage: StageSettingsDto } | undefined;

function StageList({
  pipeline,
  stages,
  onChange,
}: {
  pipeline: PipelineSettingsDto;
  stages: StageSettingsDto[];
  onChange: (stages: StageSettingsDto[]) => void;
}) {
  const t = useTranslations('pipelineSettings');
  const common = useTranslations('common');
  const fieldName = useTranslations('pipelineSettings.stageField');
  const reorder = useCommand(reorderStages);
  const [dialog, setDialog] = useState<Dialog>();
  const buttons = useFocusTargets<string>();
  const open = stages.filter((s) => s.kind === 'open');
  const headingId = `stages-${pipeline.id}`;

  function move(index: number, delta: -1 | 1) {
    if (reorder.pending) return;
    const order = moveItem(open, index, delta).map((s) => s.id);
    const moved = open[index];
    reorder.run({ pipelineId: pipeline.id, stageIds: order }, (list) => {
      onChange(list.stages);
      toast.success(t('orderSaved'));
      // Focus follows the stage to its new place, on the same arrow when it is still there.
      const to = index + delta;
      const again = to > 0 && to < open.length - 1 ? delta : -delta;
      if (moved) buttons.get(`${moved.id}:${String(again)}`)[0]?.focus();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <h4 id={headingId} className="font-semibold">
        {t('stages', { name: pipeline.name })}
      </h4>
      <ol aria-labelledby={headingId} className="flex flex-col gap-2">
        {stages.map((stage) => {
          const index = open.findIndex((s) => s.id === stage.id);
          const isOpen = stage.kind === 'open';
          return (
            <li
              key={stage.id}
              className="border-border flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  <span id={`${stage.id}-name`}>{stage.name}</span>
                  {isOpen ? null : <StatusBadge tone="neutral">{t('closing')}</StatusBadge>}
                </span>
                {isOpen ? (
                  <span className="text-text-muted text-sm">
                    {stage.requiredFields.length === 0
                      ? t('requiredNone')
                      : t('requiredList', {
                          fields: stage.requiredFields.map((f) => fieldName(f)).join(', '),
                        })}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isOpen ? (
                  <>
                    <Button
                      ref={buttons.ref(`${stage.id}:-1`)}
                      variant="ghost"
                      size="sm"
                      // The visible words are the name (on a phone read out only), the stage
                      // is the description, so a voice command that says them finds the button.
                      aria-describedby={`${stage.id}-name`}
                      disabled={index <= 0}
                      onClick={() => {
                        move(index, -1);
                      }}
                    >
                      <ArrowUp aria-hidden className="size-4" />
                      <span className="sr-only sm:not-sr-only">{t('moveUp')}</span>
                    </Button>
                    <Button
                      ref={buttons.ref(`${stage.id}:1`)}
                      variant="ghost"
                      size="sm"
                      aria-describedby={`${stage.id}-name`}
                      disabled={index >= open.length - 1}
                      onClick={() => {
                        move(index, 1);
                      }}
                    >
                      <ArrowDown aria-hidden className="size-4" />
                      <span className="sr-only sm:not-sr-only">{t('moveDown')}</span>
                    </Button>
                  </>
                ) : null}
                <Button
                  ref={buttons.ref(`${stage.id}:edit`)}
                  variant="secondary"
                  size="sm"
                  aria-label={t('editLabel', { name: stage.name })}
                  onClick={() => {
                    setDialog({ kind: 'edit', stage });
                  }}
                >
                  {t('edit')}
                </Button>
                {isOpen && index > 0 && !KEPT.has(stage.key) ? (
                  <Button
                    ref={buttons.ref(`${stage.id}:archive`)}
                    variant="secondary"
                    size="sm"
                    aria-label={t('archiveLabel', { name: stage.name })}
                    onClick={() => {
                      setDialog({ kind: 'archive', stage });
                    }}
                  >
                    {t('archive')}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <FailureMessage failure={reorder.failure} />
      <AddStageForm
        pipelineId={pipeline.id}
        onAdded={(stage) => {
          onChange(withStage(stages, stage));
        }}
      />
      {dialog?.kind === 'edit' ? (
        <StageDialog
          stage={dialog.stage}
          closeLabel={common('close')}
          returnFocusTo={() => [buttons.get(`${dialog.stage.id}:edit`)]}
          onSaved={(saved) => {
            onChange(stages.map((s) => (s.id === saved.id ? saved : s)));
            setDialog(undefined);
            toast.success(t('stageSaved', { name: saved.name }));
          }}
          onClose={() => {
            setDialog(undefined);
          }}
        />
      ) : null}
      {dialog?.kind === 'archive' ? (
        <ArchiveStageDialog
          stage={dialog.stage}
          closeLabel={common('close')}
          // An archived stage leaves the list: focus goes to the stage before it, or else to the
          // box that adds a stage.
          returnFocusTo={() => {
            const at = open.findIndex((s) => s.id === dialog.stage.id);
            const before = open[at - 1];
            return [
              buttons.get(`${dialog.stage.id}:edit`),
              before === undefined ? [] : buttons.get(`${before.id}:edit`),
              document.getElementById(`${pipeline.id}-new-stage`),
            ];
          }}
          onArchived={(archived) => {
            onChange(stages.filter((s) => s.id !== archived.id));
            setDialog(undefined);
            toast.success(t('stageArchived', { name: archived.name }));
          }}
          onClose={() => {
            setDialog(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function AddStageForm({
  pipelineId,
  onAdded,
}: {
  pipelineId: string;
  onAdded: (stage: StageSettingsDto) => void;
}) {
  const t = useTranslations('pipelineSettings');
  const { run, pending, failure } = useCommand(createStage);
  const { fieldError, formFailure } = useFieldFailure(failure, ['name']);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const name = formText(new FormData(form), 'name');
    run({ pipelineId, name }, (stage) => {
      form.reset();
      onAdded(stage);
      toast.success(t('stageAdded', { name: stage.name }));
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field
          id={`${pipelineId}-new-stage`}
          label={t('newStage')}
          error={fieldError('name')}
          className="sm:flex-1"
        >
          <Input name="name" required minLength={2} maxLength={60} autoComplete="off" />
        </Field>
        <Button type="submit" variant="secondary" pending={pending}>
          {t('addStage')}
        </Button>
      </div>
      <FailureMessage failure={formFailure} />
    </form>
  );
}
