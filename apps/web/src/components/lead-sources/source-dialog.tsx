'use client';

import type {
  ConsentChannel,
  IngestFieldTarget,
  IngestSourceDto,
  IngestSourceProvider,
  PipelineDto,
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
  toast,
  type ReturnFocusTo,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';
import { setIngestSource } from '../../actions/lead-sources';
import {
  CONSENT_CHANNELS,
  CONSENT_PURPOSES,
  INGEST_FIELD_TARGETS,
  INGEST_SOURCE_PROVIDERS,
} from '../../screens/contract-values';
import {
  externalIdLabel,
  fieldMapOf,
  mapIsComplete,
  mapRows,
  type MapRow,
} from '../../screens/lead-sources';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/**
 * Connecting a form, Page or site to a company, or changing it (`crm.source.set`): its name, where
 * its leads go, how each of its questions is matched (the questions of its newest lead come first,
 * so the map is set from what the form really asks), its consent question, and a Facebook form's
 * Page token, which is sealed when saved and never shown again.
 */
export function SourceDialog({
  entityId,
  source,
  pipelines,
  closeLabel,
  returnFocusTo,
  onSaved,
  onClose,
}: {
  entityId: number;
  source: IngestSourceDto | undefined;
  pipelines: readonly PipelineDto[];
  closeLabel: string;
  returnFocusTo: ReturnFocusTo;
  onSaved: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('leadSources');
  const common = useTranslations('common');
  const id = useId();
  const { run, pending, failure } = useCommand(
    setIngestSource,
    source?.id ?? `new:${String(entityId)}`,
  );
  const failures = useFieldFailure(failure, [
    'externalId',
    'name',
    'pipelineId',
    'fieldMap',
    'pageToken',
    'consent.questionKey',
    'consent.textVersion',
  ]);
  const [provider, setProvider] = useState<IngestSourceProvider>(
    source?.provider ?? 'meta_leadgen',
  );
  const [rows, setRows] = useState<MapRow[]>(() => mapRows(source));
  const [consentKey, setConsentKey] = useState(source?.consent?.questionKey ?? '');
  const [channels, setChannels] = useState<ConsentChannel[]>(source?.consent?.channels ?? ['call']);
  const map = fieldMapOf(rows);

  function setTarget(index: number, target: IngestFieldTarget | '') {
    setRows((all) => all.map((r, i) => (i === index ? { ...r, target } : r)));
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    const token = formText(data, 'pageToken');
    const textVersion = formText(data, 'consentTextVersion');
    const purpose = formText(data, 'consentPurpose');
    run(
      {
        entityId,
        ...(source === undefined ? {} : { sourceId: source.id }),
        provider,
        externalId: source?.externalId ?? formText(data, 'externalId'),
        name: formText(data, 'name'),
        pipelineId: formText(data, 'pipelineId'),
        fieldMap: map,
        consent:
          consentKey === '' ? null : { questionKey: consentKey, textVersion, channels, purpose },
        ...(provider === 'meta_leadgen' && token !== '' ? { pageToken: token } : {}),
      },
      (saved) => {
        toast.success(t('saved', { name: saved.name }));
        onSaved();
      },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={closeLabel} returnFocusTo={returnFocusTo}>
        <DialogHeader>
          <DialogTitle>{source === undefined ? t('connectTitle') : t('changeTitle')}</DialogTitle>
          <DialogDescription>{t('dialogIntro')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {source === undefined ? (
            <Field id={`${id}-provider`} label={t('kind')}>
              <Select
                value={provider}
                onChange={(e) => {
                  setProvider(e.currentTarget.value as IngestSourceProvider);
                }}
              >
                {INGEST_SOURCE_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {t(`provider.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field
            id={`${id}-external`}
            label={t(externalIdLabel(provider))}
            helper={
              source !== undefined
                ? t('fixed')
                : externalIdLabel(provider) === 'siteHost'
                  ? t('siteHostHelper')
                  : t('formIdHelper')
            }
            error={failures.fieldError('externalId')}
          >
            <Input
              name="externalId"
              defaultValue={source?.externalId ?? ''}
              readOnly={source !== undefined}
              required
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field id={`${id}-name`} label={t('name')} error={failures.fieldError('name')}>
            <Input name="name" defaultValue={source?.name ?? ''} required maxLength={80} />
          </Field>
          <Field
            id={`${id}-pipeline`}
            label={t('pipeline')}
            helper={t('pipelineHelper')}
            error={failures.fieldError('pipelineId')}
          >
            <Select
              name="pipelineId"
              defaultValue={source?.pipelineId ?? pipelines[0]?.id}
              required
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-h3 mb-1">{t('questions')}</legend>
            <p className="text-text-muted text-sm">
              {rows.length === 0 ? t('noQuestionsYet') : t('questionsIntro')}
            </p>
            {rows.map((row, index) => (
              <Field
                key={`${row.key}-${String(index)}`}
                id={`${id}-q-${String(index)}`}
                label={row.label === null ? row.key : `${row.label} (${row.key})`}
              >
                <Select
                  value={row.target}
                  onChange={(e) => {
                    setTarget(index, e.currentTarget.value as IngestFieldTarget | '');
                  }}
                >
                  <option value="">{t('targets.none')}</option>
                  {INGEST_FIELD_TARGETS.map((target) => (
                    <option key={target} value={target}>
                      {t(`targets.${target}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
            <AddQuestion
              onAdd={(key) => {
                setRows((all) =>
                  all.some((r) => r.key === key) ? all : [...all, { key, label: null, target: '' }],
                );
              }}
            />
            {mapIsComplete(map) ? null : (
              <p className="text-warning text-sm" role="status">
                {t('incomplete')}
              </p>
            )}
            {failures.fieldError('fieldMap') === undefined ? null : (
              <p className="text-danger text-sm">{failures.fieldError('fieldMap')}</p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-h3 mb-1">{t('consent')}</legend>
            <Field
              id={`${id}-consent-key`}
              label={t('consentKey')}
              helper={t('consentKeyHelper')}
              error={failures.fieldError('consent.questionKey')}
            >
              <Select
                value={consentKey}
                onChange={(e) => {
                  setConsentKey(e.currentTarget.value);
                }}
              >
                <option value="">{t('noConsent')}</option>
                {rows.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label ?? r.key}
                  </option>
                ))}
              </Select>
            </Field>
            {consentKey === '' ? null : (
              <>
                <Field
                  id={`${id}-consent-version`}
                  label={t('consentVersion')}
                  helper={t('consentVersionHelper')}
                  error={failures.fieldError('consent.textVersion')}
                >
                  <Input
                    name="consentTextVersion"
                    defaultValue={source?.consent?.textVersion ?? ''}
                    required
                    maxLength={60}
                    autoComplete="off"
                  />
                </Field>
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-semibold">{t('consentChannels')}</legend>
                  <div className="flex flex-wrap gap-4">
                    {CONSENT_CHANNELS.map((channel) => (
                      <label key={channel} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="accent-accent size-4"
                          checked={channels.includes(channel)}
                          onChange={(e) => {
                            const on = e.currentTarget.checked;
                            setChannels((all) =>
                              on ? [...all, channel] : all.filter((c) => c !== channel),
                            );
                          }}
                        />
                        {t(`channels.${channel}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Field id={`${id}-consent-purpose`} label={t('consentPurpose')}>
                  <Select
                    name="consentPurpose"
                    defaultValue={source?.consent?.purpose ?? 'service'}
                  >
                    {CONSENT_PURPOSES.map((p) => (
                      <option key={p} value={p}>
                        {t(`purposes.${p}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
          </fieldset>

          {provider === 'meta_leadgen' ? (
            <Field
              id={`${id}-token`}
              label={t('pageToken')}
              helper={source?.pageTokenSet === true ? t('pageTokenKept') : t('pageTokenHelper')}
              error={failures.fieldError('pageToken')}
            >
              <Input
                name="pageToken"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={1000}
              />
            </Field>
          ) : null}

          <FailureMessage failure={failures.formFailure} />
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              {common('cancel')}
            </Button>
            <Button type="submit" pending={pending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A question the form asks that no lead has brought yet, typed by its own key. */
function AddQuestion({ onAdd }: { onAdd: (key: string) => void }) {
  const t = useTranslations('leadSources');
  const id = useId();
  const [key, setKey] = useState('');
  return (
    <Field
      id={`${id}-add`}
      label={t('addQuestion')}
      helper={t('addQuestionHelper')}
      actions={
        <Button
          variant="secondary"
          onClick={() => {
            const trimmed = key.trim();
            if (trimmed === '') return;
            onAdd(trimmed);
            setKey('');
          }}
        >
          {t('add')}
        </Button>
      }
    >
      <Input
        value={key}
        onChange={(e) => {
          setKey(e.currentTarget.value);
        }}
        maxLength={200}
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  );
}
