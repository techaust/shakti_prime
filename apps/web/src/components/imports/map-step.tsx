'use client';

import type { ImportField, ImportJobDto, ImportTemplateDto, LeadSourceDto } from '@shakti/contracts';
import { Button, cn, Field, Input, Select } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { mapImportJob, previewImportJob } from '../../actions/imports';
import {
  buildMapInput,
  draftForFile,
  IMPORT_FIELDS_BY_KIND,
  initialDraft,
  isDefaultable,
  mappingProblems,
  screenKind,
  withColumn,
  withDefault,
  type DefaultableField,
  type MappingDraft,
} from '../../screens/import-wizard';
import { ACCOUNT_TYPES, CUSTOMER_LANGUAGES, SITE_TYPES } from '../../screens/lead-form';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

export interface PipelineChoice {
  key: string;
  name: string;
}

/**
 * Step two of an import: which column of the file fills each field of its kind (a lead, a
 * customer, a post office), a value for rows whose cell is empty, and an optional name to save the
 * layout under. The problems the contract would
 * refuse are shown before anything is sent. Matching and checking the rows are two commands, run
 * one after the other, each with its own idempotency key for this rendered form.
 */
export function MapStep({
  job,
  templates,
  topRow,
  pipelines,
  sources,
  onCancel,
  onDone,
  refreshing,
}: {
  job: ImportJobDto;
  templates: ImportTemplateDto[];
  topRow: Record<string, string>;
  pipelines: PipelineChoice[];
  sources: LeadSourceDto[];
  /** Given when the job was matched before: go back to its rows without changing anything. */
  onCancel: (() => void) | undefined;
  onDone: () => void;
  refreshing: boolean;
}) {
  const t = useTranslations('imports.map');
  const fields = useTranslations('imports.fields');
  const leads = useTranslations('leads');
  const map = useCommand(mapImportJob);
  const preview = useCommand(previewImportJob);
  const kind = screenKind(job.kind);
  const [draft, setDraft] = useState<MappingDraft>(() => initialDraft(job));
  const [templateId, setTemplateId] = useState(job.templateId ?? '');
  const [showProblems, setShowProblems] = useState(false);
  const problems = mappingProblems(draft, kind);
  const hasProblems = Object.keys(problems).length > 0;
  const pending = map.pending || preview.pending || refreshing;

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((x) => x.id === id);
    if (template !== undefined) setDraft(draftForFile(template.mapping, job.columns));
  }

  function setColumn(field: ImportField, column: string) {
    setDraft((d) => withColumn(d, field, column));
  }

  function setDefault(field: DefaultableField, value: string) {
    setDraft((d) => withDefault(d, field, value));
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setShowProblems(true);
    if (hasProblems) return;
    const saveAs = new FormData(e.currentTarget).get('saveAs');
    const input = buildMapInput({
      entityId: job.entityId,
      jobId: job.id,
      draft,
      template: templates.find((x) => x.id === templateId),
      saveAs: typeof saveAs === 'string' ? saveAs : '',
      kind,
    });
    map.run(input, () => {
      preview.run({ entityId: job.entityId, jobId: job.id }, onDone);
    });
  }

  function defaultChoices(field: DefaultableField): { value: string; label: string }[] {
    switch (field) {
      case 'pipelineKey':
        return pipelines.map((p) => ({ value: p.key, label: p.name }));
      case 'accountType':
        return ACCOUNT_TYPES.map((v) => ({ value: v, label: leads(`accountType.${v}`) }));
      case 'preferredLanguage':
        return CUSTOMER_LANGUAGES.map((v) => ({ value: v, label: leads(`language.${v}`) }));
      case 'siteType':
        return SITE_TYPES.map((v) => ({ value: v, label: leads(`siteType.${v}`) }));
      case 'sourceCode':
        return sources.map((s) => ({ value: s.code, label: s.name }));
    }
  }

  const failure = map.failure ?? preview.failure;
  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-1">
        <h2 className="text-h2">{t('title')}</h2>
        <p className="text-text-muted">{t('intro', { kind })}</p>
      </div>

      {templates.length === 0 ? null : (
        <Field id="map-template" label={t('template')} helper={t('templateHelper')}>
          <Select
            value={templateId}
            onChange={(e) => {
              applyTemplate(e.currentTarget.value);
            }}
          >
            <option value="">{t('templateNone')}</option>
            {templates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <ul className="border-border bg-surface flex flex-col rounded-lg border">
        {IMPORT_FIELDS_BY_KIND[kind].map((field) => {
          const column = draft.columns[field];
          const problem = showProblems ? problems[field] : undefined;
          const top = column === undefined ? undefined : (topRow[column] ?? '').trim();
          return (
            <li
              key={field}
              className="border-border flex flex-col gap-3 border-b p-4 last:border-b-0"
            >
              <h3 className="text-h3">{fields(field)}</h3>
              <div className={cn('grid gap-4', isDefaultable(field, kind) && 'sm:grid-cols-2')}>
                <Field
                  id={`map-${field}-column`}
                  label={t('column')}
                  helper={
                    top === undefined
                      ? undefined
                      : top === ''
                        ? t('firstRowEmpty')
                        : t('firstRow', { value: top })
                  }
                  error={problem === undefined ? undefined : t(`problems.${problem}`)}
                >
                  <Select
                    value={column ?? ''}
                    onChange={(e) => {
                      setColumn(field, e.currentTarget.value);
                    }}
                  >
                    <option value="">{t('notInFile')}</option>
                    {job.columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>
                {isDefaultable(field, kind) ? (
                  <Field id={`map-${field}-default`} label={t('everyRow')}>
                    <Select
                      value={draft.defaults[field] ?? ''}
                      onChange={(e) => {
                        setDefault(field, e.currentTarget.value);
                      }}
                    >
                      <option value="">{t('leaveEmpty')}</option>
                      {defaultChoices(field).map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Field id="map-save-as" label={t('saveAs')} helper={t('saveAsHelper')}>
        <Input name="saveAs" minLength={2} maxLength={80} autoComplete="off" />
      </Field>

      {showProblems && hasProblems ? (
        <p role="alert" className="text-danger text-sm">
          {t('fixProblems')}
        </p>
      ) : null}
      <FailureMessage failure={failure} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel === undefined ? null : (
          <Button variant="secondary" onClick={onCancel}>
            {t('cancel')}
          </Button>
        )}
        <Button type="submit" pending={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
