'use client';

import type {
  CustomerDocumentsDto,
  DocumentDto,
  DocumentFlow,
  DocumentRequirementDto,
} from '@shakti/contracts';
import { Button, EmptyState, Skeleton, StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { loadCustomerDocuments } from '../../actions/documents';
import { DOCUMENT_STEP_KEYS } from '../../screens/document-values';
import { formatDate } from '../../screens/format';
import type { UploadLimitView } from '../companies/branding-dialog';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import { FlowChoice } from './flow-choice';
import { useOpenDocument } from './use-open-document';
import type { DocumentDialogKind } from './documents-dialogs';

// The upload and unfile dialogs load on first use, so the page ships only what it shows.
const DocumentDialog = dynamic(() => import('./documents-dialogs').then((m) => m.DocumentDialog));

/**
 * A customer's documents in one company (docs/03-roadmap-appendix/phase4.md §6.3): the
 * requirements of a flow's steps with whether each is filed, and the documents the caller may read,
 * each opened as its masked copy. An identity or bank paper shows only to a holder of
 * documents.sensitive.read, with the last four digits of its number. Account 360 shows it, and the
 * project page's Documents tab once projects exist.
 */
export function CustomerDocuments({
  entityId,
  accountId,
  limit,
}: {
  entityId: number;
  accountId: string;
  /** The upload limits of a customer document. */
  limit: UploadLimitView;
}) {
  const t = useTranslations('documents');
  const [view, setView] = useState<CustomerDocumentsDto | undefined>();
  const [flow, setFlow] = useState<DocumentFlow>('standard');
  const [dialog, setDialog] = useState<DocumentDialogKind | undefined>();
  const read = useQuery<CustomerDocumentsDto>();
  const opener = useOpenDocument();
  // `load` is stable; `read` is a new object each render, so it is not a dependency.
  const { load } = read;

  useEffect(() => {
    load(() => loadCustomerDocuments({ entityId, accountId }), setView);
  }, [load, entityId, accountId]);

  function done() {
    setDialog(undefined);
    load(() => loadCustomerDocuments({ entityId, accountId }), setView);
  }

  return (
    <section
      aria-labelledby="account-documents"
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="account-documents" className="text-h3">
          {t('section.title')}
        </h2>
        {view?.canFile === true ? (
          <Button
            variant="secondary"
            onClick={() => {
              setDialog({ kind: 'upload', requirementKey: null });
            }}
          >
            {t('section.uploadDocument')}
          </Button>
        ) : null}
      </div>
      <FailureMessage failure={read.failure ?? opener.failure} />
      {view === undefined ? (
        read.failure === undefined ? (
          <Skeleton className="h-24" />
        ) : null
      ) : (
        <>
          <Requirements
            view={view}
            flow={flow}
            onFlow={setFlow}
            onUpload={(requirementKey) => {
              setDialog({ kind: 'upload', requirementKey });
            }}
          />
          <Filed
            view={view}
            opening={opener.opening}
            onOpen={(document) => {
              opener.open(entityId, document.id);
            }}
            onUnfile={(document) => {
              setDialog({ kind: 'unfile', document });
            }}
          />
        </>
      )}
      {dialog === undefined || view === undefined ? null : (
        <DocumentDialog
          dialog={dialog}
          view={view}
          flow={flow}
          limit={limit}
          onDone={done}
          onCancel={() => {
            setDialog(undefined);
          }}
        />
      )}
    </section>
  );
}

/** The requirements of the chosen flow, step by step, each filed, missing or optional. */
function Requirements({
  view,
  flow,
  onFlow,
  onUpload,
}: {
  view: CustomerDocumentsDto;
  flow: DocumentFlow;
  onFlow: (flow: DocumentFlow) => void;
  onUpload: (requirementKey: DocumentRequirementDto['requirementKey']) => void;
}) {
  const t = useTranslations('documents');
  const steps = DOCUMENT_STEP_KEYS[flow].flatMap((stepKey) => {
    const rows = view.requirements
      .filter((r) => r.flow === flow && r.stepKey === stepKey)
      .sort((a, b) => a.position - b.position);
    return rows.length === 0 ? [] : [{ stepKey, rows }];
  });

  function stateOf(r: DocumentRequirementDto): 'filed' | 'missing' | 'optional' {
    const missing = view.missing.find((m) => m.flow === r.flow && m.stepKey === r.stepKey);
    if (r.mandatory) {
      return missing?.requirementKeys.includes(r.requirementKey) === true ? 'missing' : 'filed';
    }
    const filed = view.documents.some(
      (d) =>
        d.unfiledAt === null &&
        d.requirementKey === r.requirementKey &&
        r.acceptedKinds.includes(d.kind),
    );
    return filed ? 'filed' : 'optional';
  }

  return (
    <div className="flex flex-col gap-3">
      <FlowChoice flow={flow} onFlow={onFlow} label={t('section.flowLabel')} showLabel />
      {steps.length === 0 ? (
        <EmptyState message={t('section.noRequirements')} />
      ) : (
        steps.map(({ stepKey, rows }) => (
          <div key={stepKey} className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">{t(`step.${stepKey}`)}</h3>
            <ul className="divide-border flex flex-col divide-y">
              {rows.map((r) => {
                const state = stateOf(r);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{t(`requirement.${r.requirementKey}`)}</span>
                      {state === 'filed' ? (
                        <StatusBadge tone="success">{t('section.filed')}</StatusBadge>
                      ) : state === 'missing' ? (
                        <StatusBadge tone="warning">{t('section.missing')}</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">{t('section.optional')}</StatusBadge>
                      )}
                    </span>
                    {view.canFile && state !== 'filed' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t('section.uploadFor', {
                          requirement: t(`requirement.${r.requirementKey}`),
                        })}
                        onClick={() => {
                          onUpload(r.requirementKey);
                        }}
                      >
                        {t('section.upload')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

/** The customer's documents the caller may read, newest first, filed or unfiled. */
function Filed({
  view,
  opening,
  onOpen,
  onUnfile,
}: {
  view: CustomerDocumentsDto;
  opening: boolean;
  onOpen: (document: DocumentDto) => void;
  onUnfile: (document: DocumentDto) => void;
}) {
  const t = useTranslations('documents');
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{t('section.documents')}</h3>
      {view.documents.length === 0 ? (
        <EmptyState message={t('section.none')} />
      ) : (
        <ul className="divide-border flex flex-col divide-y">
          {view.documents.map((d) => {
            const kind = t(`kind.${d.kind}`);
            return (
              <li key={d.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{kind}</span>
                    {d.sensitive ? (
                      <StatusBadge tone="info">{t('section.sensitive')}</StatusBadge>
                    ) : null}
                    {d.unfiledAt === null ? null : (
                      <StatusBadge tone="neutral">{t('state.unfiled')}</StatusBadge>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {/* An unfiled document's file is no longer opened through it. */}
                    {d.unfiledAt === null ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        pending={opening}
                        aria-label={t('section.viewLabel', { kind })}
                        onClick={() => {
                          onOpen(d);
                        }}
                      >
                        {t('section.view')}
                      </Button>
                    ) : null}
                    {view.canFile && d.unfiledAt === null ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t('section.unfileLabel', { kind })}
                        onClick={() => {
                          onUnfile(d);
                        }}
                      >
                        {t('section.unfile')}
                      </Button>
                    ) : null}
                  </span>
                </div>
                <p className="text-text-muted text-sm">
                  {d.requirementKey === null
                    ? t('section.filedOn', { when: formatDate(d.filedAt) })
                    : t('section.filedFor', {
                        requirement: t(`requirement.${d.requirementKey}`),
                        when: formatDate(d.filedAt),
                      })}
                </p>
                {d.lastFour.map((n) => (
                  <p key={`${n.kind}-${n.lastFour}`} className="text-sm">
                    {t(`section.lastFour.${n.kind}`, { digits: n.lastFour })}
                  </p>
                ))}
                {d.unfiledReason === null ? null : (
                  <p className="text-text-muted text-sm">
                    {t('section.unfiledBecause', { reason: d.unfiledReason })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
