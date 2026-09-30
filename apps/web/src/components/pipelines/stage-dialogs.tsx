'use client';

import type { StageExitField, StageSettingsDto } from '@shakti/contracts';
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
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useId, type SyntheticEvent } from 'react';
import { archiveStage, updateStage } from '../../actions/crm-settings';
import { RECORDED_STAGE_EXIT_FIELDS, STAGE_EXIT_FIELDS } from '../../screens/contract-values';
import { stageChanges } from '../../screens/pipeline-settings';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

const RECORDED: ReadonlySet<StageExitField> = new Set(RECORDED_STAGE_EXIT_FIELDS);

interface DialogProps {
  stage: StageSettingsDto;
  closeLabel: string;
  /** Where focus goes when the dialog closes: the stage's Edit button. */
  returnFocusTo: ReturnFocusTo;
  onClose: () => void;
}

/**
 * Edits one stage: its name and, for an open stage, the details a lead needs before it moves on.
 * Details the sizing panel will record are listed but cannot be ticked until leads carry them.
 */
export function StageDialog({
  onSaved,
  ...props
}: DialogProps & { onSaved: (s: StageSettingsDto) => void }) {
  const t = useTranslations('pipelineSettings');
  const fieldName = useTranslations('pipelineSettings.stageField');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(updateStage);
  const { fieldError, formFailure } = useFieldFailure(failure, ['name', 'requiredFields']);
  const { stage } = props;
  const legendId = useId();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const ticked = data.getAll('requiredFields').filter((v): v is string => typeof v === 'string');
    const changes = stageChanges(stage, {
      name: formText(data, 'name'),
      requiredFields: STAGE_EXIT_FIELDS.filter((f) => ticked.includes(f)),
    });
    if (changes === undefined) {
      props.onClose();
      return;
    }
    run({ stageId: stage.id, ...changes }, onSaved);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent closeLabel={props.closeLabel} returnFocusTo={props.returnFocusTo}>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('stageDialogTitle')}</DialogTitle>
            <DialogDescription>{t('stageDialogIntro')}</DialogDescription>
          </DialogHeader>
          <Field id={`${stage.id}-name`} label={t('stageName')} error={fieldError('name')}>
            <Input
              name="name"
              defaultValue={stage.name}
              required
              minLength={2}
              maxLength={60}
              autoComplete="off"
            />
          </Field>
          {stage.kind === 'open' ? (
            <fieldset className="flex flex-col gap-2" aria-describedby={`${legendId}-helper`}>
              <legend className="text-text-muted mb-1 text-sm font-medium">
                {t('requiredFields')}
              </legend>
              <p id={`${legendId}-helper`} className="text-text-subtle text-xs">
                {t('requiredFieldsHelper')}
              </p>
              {STAGE_EXIT_FIELDS.map((field) => {
                const recorded = RECORDED.has(field);
                return (
                  <label
                    key={field}
                    className="flex min-h-8 items-center gap-2 text-sm aria-disabled:opacity-60"
                    aria-disabled={recorded ? undefined : true}
                  >
                    <input
                      type="checkbox"
                      name="requiredFields"
                      value={field}
                      defaultChecked={stage.requiredFields.includes(field)}
                      disabled={!recorded}
                      className="accent-accent size-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                    />
                    {recorded ? fieldName(field) : t('laterField', { field: fieldName(field) })}
                  </label>
                );
              })}
              {fieldError('requiredFields') === undefined ? null : (
                <p className="text-danger text-sm">{fieldError('requiredFields')}</p>
              )}
            </fieldset>
          ) : null}
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={props.onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('saveStage')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Asks before an open stage leaves the board; the command refuses one that still holds leads. */
export function ArchiveStageDialog({
  onArchived,
  ...props
}: DialogProps & { onArchived: (s: StageSettingsDto) => void }) {
  const t = useTranslations('pipelineSettings');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(archiveStage);
  const { stage } = props;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent closeLabel={props.closeLabel} returnFocusTo={props.returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{t('archiveTitle')}</DialogTitle>
          <DialogDescription>{t('archiveBody', { name: stage.name })}</DialogDescription>
        </DialogHeader>
        <FailureMessage failure={failure} />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={props.onClose}>
            {common('cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            pending={pending}
            onClick={() => {
              if (!pending) run({ stageId: stage.id }, onArchived);
            }}
          >
            {t('archiveConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
