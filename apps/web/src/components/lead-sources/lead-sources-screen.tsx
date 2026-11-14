'use client';

import type {
  IngestKeyDto,
  IngestSourceDto,
  IngestSourcesDto,
  PipelineDto,
} from '@shakti/contracts';
import {
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  StatusBadge,
  toast,
  useFocusTargets,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useId, useState, type SyntheticEvent } from 'react';
import {
  archiveIngestSource,
  createIngestKey,
  listIngestSources,
  revokeIngestKey,
} from '../../actions/lead-sources';
import { mapIsComplete } from '../../screens/lead-sources';
import { momentValues } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand, useQuery } from '../screens/use-command';

/** The source form, fetched when an Executive first opens it rather than with the page. */
const SourceDialog = dynamic(() => import('./source-dialog').then((m) => m.SourceDialog));

/**
 * Settings › Lead sources (docs/03-roadmap-appendix/phase2.md §6.2): for one company at a time,
 * the Facebook and Instagram lead forms, Google lead forms and websites connected to it, each with
 * the business line its leads go to, how its questions are matched, its consent question and, for
 * a Facebook form, whether its Page is connected; and the website keys, made (shown once) and
 * turned off here. An Executive's screen (`crm.sources.write`).
 */
export function LeadSourcesScreen({
  companies,
  pipelines,
}: {
  companies: readonly { id: number; name: string }[];
  pipelines: readonly PipelineDto[];
}) {
  const t = useTranslations('leadSources');
  const pickerId = useId();
  const [entityId, setEntityId] = useState(companies[0]?.id);
  const { load, failure } = useQuery<IngestSourcesDto>();
  const [data, setData] = useState<IngestSourcesDto | undefined>();
  const [editing, setEditing] = useState<IngestSourceDto | 'new' | undefined>();
  const focus = useFocusTargets<string>();

  const reload = useCallback(() => {
    if (entityId === undefined) return;
    load(() => listIngestSources({ entityId }), setData);
  }, [entityId, load]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (entityId === undefined) return <EmptyState message={t('noCompany')} />;
  const offered = pipelines.filter((p) => p.entityId === null || p.entityId === entityId);
  const pipelineName = (id: string) => pipelines.find((p) => p.id === id)?.name ?? '';

  return (
    <div className="flex flex-col gap-8">
      <Field id={pickerId} label={t('company')}>
        <Select
          value={String(entityId)}
          onChange={(e) => {
            // The lists of the company chosen replace the last one's once they arrive.
            setData(undefined);
            setEntityId(Number(e.currentTarget.value));
          }}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      {data === undefined ? (
        failure === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <FailureMessage failure={failure} />
        )
      ) : (
        <>
          <section aria-labelledby={`${pickerId}-sources`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id={`${pickerId}-sources`} className="text-h2">
                {t('sourcesHeading')}
              </h2>
              <Button
                ref={focus.ref('new')}
                onClick={() => {
                  setEditing('new');
                }}
              >
                {t('connect')}
              </Button>
            </div>
            <p className="text-text-muted text-sm">{t('sourcesIntro')}</p>
            <SourceList
              sources={data.sources}
              pipelineName={pipelineName}
              entityId={entityId}
              focusRef={focus.ref}
              onEdit={setEditing}
              onArchived={reload}
            />
          </section>
          <KeysSection entityId={entityId} keys={data.keys} onChanged={reload} />
        </>
      )}

      {editing === undefined ? null : (
        <SourceDialog
          entityId={entityId}
          source={editing === 'new' ? undefined : editing}
          pipelines={offered}
          closeLabel={t('close')}
          returnFocusTo={() => [focus.get(editing === 'new' ? 'new' : editing.id)]}
          onSaved={() => {
            setEditing(undefined);
            reload();
          }}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}

function SourceList({
  sources,
  pipelineName,
  entityId,
  focusRef,
  onEdit,
  onArchived,
}: {
  sources: readonly IngestSourceDto[];
  pipelineName: (id: string) => string;
  entityId: number;
  focusRef: (key: string) => (el: HTMLElement | null) => void;
  onEdit: (source: IngestSourceDto) => void;
  onArchived: () => void;
}) {
  const t = useTranslations('leadSources');
  const archive = useCommand(archiveIngestSource);
  const live = sources.filter((s) => s.archivedAt === null);
  if (live.length === 0) return <EmptyState message={t('noSources')} />;
  return (
    <>
      <ul className="divide-border flex flex-col divide-y" aria-label={t('sourcesHeading')}>
        {live.map((s) => {
          const complete = mapIsComplete(s.fieldMap);
          return (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold">{s.name}</span>
                <span className="text-text-muted text-sm">
                  {t(`provider.${s.provider}`)} · {s.externalId} · {pipelineName(s.pipelineId)}
                </span>
                <span className="flex flex-wrap gap-2">
                  <StatusBadge tone={complete ? 'success' : 'warning'}>
                    {complete ? t('matched') : t('notMatched')}
                  </StatusBadge>
                  <StatusBadge tone={s.consent === null ? 'neutral' : 'success'}>
                    {s.consent === null ? t('noConsentQuestion') : t('consentQuestion')}
                  </StatusBadge>
                  {s.provider === 'meta_leadgen' ? (
                    <StatusBadge tone={s.pageTokenSet ? 'success' : 'warning'}>
                      {s.pageTokenSet ? t('pageConnected') : t('pageMissing')}
                    </StatusBadge>
                  ) : null}
                </span>
                <span className="text-text-muted text-sm">
                  {s.lastLeadAt === null
                    ? t('noLeadYet')
                    : t.rich('lastLead', momentValues(s.lastLeadAt))}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  ref={focusRef(s.id)}
                  aria-label={t('changeLabel', { name: s.name })}
                  onClick={() => {
                    onEdit(s);
                  }}
                >
                  {t('change')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  pending={archive.pending}
                  aria-label={t('disconnectLabel', { name: s.name })}
                  onClick={() => {
                    archive.run({ entityId, sourceId: s.id }, () => {
                      toast.success(t('disconnected', { name: s.name }));
                      onArchived();
                    });
                  }}
                >
                  {t('disconnect')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <FailureMessage failure={archive.failure} />
    </>
  );
}

function KeysSection({
  entityId,
  keys,
  onChanged,
}: {
  entityId: number;
  keys: readonly IngestKeyDto[];
  onChanged: () => void;
}) {
  const t = useTranslations('leadSources');
  const id = useId();
  const make = useCommand(createIngestKey, `key:${String(entityId)}`);
  const revoke = useCommand(revokeIngestKey);
  const [shown, setShown] = useState<{ label: string; secret: string } | undefined>();

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (make.pending) return;
    const form = e.currentTarget;
    const label = formText(new FormData(form), 'label');
    make.run({ entityId, label }, (made) => {
      setShown({ label: made.key.label, secret: made.secret });
      form.reset();
      onChanged();
    });
  }

  return (
    <section aria-labelledby={`${id}-keys`} className="flex flex-col gap-3">
      <h2 id={`${id}-keys`} className="text-h2">
        {t('keysHeading')}
      </h2>
      <p className="text-text-muted text-sm">{t('keysIntro')}</p>
      {shown === undefined ? null : (
        <div
          role="status"
          className="border-border bg-card flex flex-col gap-2 rounded-md border p-4"
        >
          <p className="font-semibold">{t('keyMade', { label: shown.label })}</p>
          <code data-dynamic className="bg-muted rounded-sm px-2 py-1 font-mono text-sm break-all">
            {shown.secret}
          </code>
          <p className="text-text-muted text-sm">{t('keyOnce')}</p>
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShown(undefined);
              }}
            >
              {t('keyCopied')}
            </Button>
          </div>
        </div>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-2">
        <Field
          id={`${id}-label`}
          label={t('keyLabel')}
          helper={t('keyLabelHelper')}
          actions={
            <Button type="submit" pending={make.pending}>
              {t('makeKey')}
            </Button>
          }
        >
          <Input name="label" required maxLength={80} autoComplete="off" />
        </Field>
        <FailureMessage failure={make.failure} />
      </form>
      {keys.length === 0 ? (
        <EmptyState message={t('noKeys')} />
      ) : (
        <ul className="divide-border flex flex-col divide-y" aria-label={t('keysHeading')}>
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-semibold">{k.label}</span>
                <span className="text-text-muted text-sm">
                  {t('endsWith', { hint: k.keyHint })}
                </span>
                <span className="text-text-muted text-sm">
                  {k.revokedAt !== null
                    ? t.rich('turnedOff', momentValues(k.revokedAt))
                    : k.lastUsedAt === null
                      ? t('neverUsed')
                      : t.rich('lastUsed', momentValues(k.lastUsedAt))}
                </span>
              </div>
              {k.revokedAt === null ? (
                <Button
                  variant="ghost"
                  size="sm"
                  pending={revoke.pending}
                  aria-label={t('turnOffLabel', { label: k.label })}
                  onClick={() => {
                    revoke.run({ entityId, keyId: k.id }, () => {
                      toast.success(t('keyTurnedOff', { label: k.label }));
                      onChanged();
                    });
                  }}
                >
                  {t('turnOff')}
                </Button>
              ) : (
                <StatusBadge tone="neutral">{t('off')}</StatusBadge>
              )}
            </li>
          ))}
        </ul>
      )}
      <FailureMessage failure={revoke.failure} />
    </section>
  );
}
