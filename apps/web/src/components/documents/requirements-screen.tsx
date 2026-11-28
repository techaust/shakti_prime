'use client';

import type {
  DocumentFlow,
  DocumentKind,
  DocumentRequirementDto,
  DocumentRequirementKey,
} from '@shakti/contracts';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  Select,
  StatusBadge,
  toast,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { listDocumentRequirements, setDocumentRequirement } from '../../actions/documents';
import {
  DOCUMENT_KINDS,
  DOCUMENT_REQUIREMENT_KEYS,
  DOCUMENT_STEP_KEYS,
} from '../../screens/document-values';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';
import { FlowChoice } from './flow-choice';

type Editing =
  { kind: 'edit'; requirement: DocumentRequirementDto } | { kind: 'add'; flow: DocumentFlow };

/**
 * Settings › Document requirements (an Executive, docs/03-roadmap-appendix/phase4.md §6.3): for
 * each company, flow and step, the documents a project needs, whether each must be filed, the kinds
 * it takes and its place. A requirement is turned off rather than removed.
 */
export function RequirementsScreen({
  companies,
  initial,
}: {
  companies: readonly { id: number; name: string }[];
  initial: { entityId: number; requirements: DocumentRequirementDto[] };
}) {
  const t = useTranslations('documents.settings');
  const docs = useTranslations('documents');
  const [entityId, setEntityId] = useState(initial.entityId);
  const [requirements, setRequirements] = useState(initial.requirements);
  const [flow, setFlow] = useState<DocumentFlow>('standard');
  const [editing, setEditing] = useState<Editing | undefined>();
  const read = useQuery<DocumentRequirementDto[]>();

  function reload(company: number) {
    read.load(() => listDocumentRequirements({ entityId: company }), setRequirements);
  }

  const steps = DOCUMENT_STEP_KEYS[flow].map((stepKey) => ({
    stepKey,
    rows: requirements
      .filter((r) => r.flow === flow && r.stepKey === stepKey)
      .sort((a, b) => a.position - b.position),
  }));

  return (
    <div className="flex flex-col gap-4">
      {companies.length > 1 ? (
        <Field id="requirements-company" label={t('company')}>
          <Select
            value={String(entityId)}
            onChange={(e) => {
              const next = Number(e.currentTarget.value);
              setEntityId(next);
              reload(next);
            }}
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FlowChoice flow={flow} onFlow={setFlow} label={t('flow')} />
        <Button
          onClick={() => {
            setEditing({ kind: 'add', flow });
          }}
        >
          {t('addRequirement')}
        </Button>
      </div>
      <FailureMessage failure={read.failure} />
      {steps.map(({ stepKey, rows }) => (
        <section
          key={stepKey}
          aria-labelledby={`step-${stepKey}`}
          className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4"
        >
          <h2 id={`step-${stepKey}`} className="text-h3">
            {docs(`step.${stepKey}`)}
          </h2>
          {rows.length === 0 ? (
            <EmptyState message={t('noneInStep')} />
          ) : (
            <ul className="divide-border flex flex-col divide-y">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{docs(`requirement.${r.requirementKey}`)}</span>
                      <StatusBadge tone={r.mandatory ? 'accent' : 'neutral'}>
                        {r.mandatory ? t('mandatory') : t('optional')}
                      </StatusBadge>
                      {r.active ? null : <StatusBadge tone="neutral">{t('off')}</StatusBadge>}
                    </span>
                    <span className="text-text-muted text-sm">
                      {t('takes', {
                        kinds: new Intl.ListFormat('en-IN', { type: 'disjunction' }).format(
                          r.acceptedKinds.map((k) => docs(`kind.${k}`)),
                        ),
                      })}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={t('editLabel', {
                      requirement: docs(`requirement.${r.requirementKey}`),
                    })}
                    onClick={() => {
                      setEditing({ kind: 'edit', requirement: r });
                    }}
                  >
                    {t('edit')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {editing === undefined ? null : (
        <RequirementDialog
          entityId={entityId}
          editing={editing}
          onDone={() => {
            setEditing(undefined);
            reload(entityId);
          }}
          onCancel={() => {
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}

function RequirementDialog({
  entityId,
  editing,
  onDone,
  onCancel,
}: {
  entityId: number;
  editing: Editing;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('documents.settings');
  const docs = useTranslations('documents');
  const common = useTranslations('common');
  const current = editing.kind === 'edit' ? editing.requirement : undefined;
  const flow = current?.flow ?? (editing.kind === 'add' ? editing.flow : 'standard');
  const [kinds, setKinds] = useState<ReadonlySet<DocumentKind>>(
    new Set(current?.acceptedKinds ?? []),
  );
  const { run, pending, failure } = useCommand(setDocumentRequirement);
  const { fieldError, formFailure } = useFieldFailure(failure, [
    'stepKey',
    'requirementKey',
    'acceptedKinds',
    'position',
  ]);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const requirementKey = DOCUMENT_REQUIREMENT_KEYS.find(
      (k) => k === (current?.requirementKey ?? formText(data, 'requirementKey')),
    );
    run(
      {
        entityId,
        flow,
        stepKey: current?.stepKey ?? formText(data, 'stepKey'),
        requirementKey: requirementKey ?? '',
        mandatory: data.get('mandatory') === 'on',
        acceptedKinds: DOCUMENT_KINDS.filter((k) => kinds.has(k)),
        position: Number(formText(data, 'position')),
        active: data.get('active') === 'on',
      },
      () => {
        toast.success(t('savedToast'));
        onDone();
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>
              {current === undefined
                ? t('addTitle', { flow: docs(`flow.${flow}`) })
                : t('editTitle', { requirement: docs(`requirement.${current.requirementKey}`) })}
            </DialogTitle>
            <DialogDescription>{t('dialogIntro')}</DialogDescription>
          </DialogHeader>
          {current === undefined ? (
            <>
              <Field id="requirement-step" label={t('step')} error={fieldError('stepKey')}>
                <Select name="stepKey" defaultValue={DOCUMENT_STEP_KEYS[flow][0]}>
                  {DOCUMENT_STEP_KEYS[flow].map((s) => (
                    <option key={s} value={s}>
                      {docs(`step.${s}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                id="requirement-key"
                label={t('requirement')}
                error={fieldError('requirementKey')}
              >
                <Select name="requirementKey" defaultValue={DOCUMENT_REQUIREMENT_KEYS[0]}>
                  {DOCUMENT_REQUIREMENT_KEYS.map((k: DocumentRequirementKey) => (
                    <option key={k} value={k}>
                      {docs(`requirement.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t('kinds')}</legend>
            {DOCUMENT_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-accent size-4"
                  checked={kinds.has(k)}
                  onChange={(e) => {
                    const next = new Set(kinds);
                    if (e.currentTarget.checked) next.add(k);
                    else next.delete(k);
                    setKinds(next);
                  }}
                />
                {docs(`kind.${k}`)}
              </label>
            ))}
            {fieldError('acceptedKinds')}
          </fieldset>
          <Field
            id="requirement-position"
            label={t('position')}
            helper={t('positionHelper')}
            error={fieldError('position')}
          >
            <Input
              name="position"
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              defaultValue={current?.position ?? 1}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="mandatory"
              className="accent-accent size-4"
              defaultChecked={current?.mandatory ?? true}
            />
            {t('mandatoryCheck')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              className="accent-accent size-4"
              defaultChecked={current?.active ?? true}
            />
            {t('activeCheck')}
          </label>
          <FailureMessage failure={formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onCancel}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('submitRequirement')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
