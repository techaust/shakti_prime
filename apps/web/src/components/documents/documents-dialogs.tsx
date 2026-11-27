'use client';

import type {
  CustomerDocumentsDto,
  DocumentDto,
  DocumentFlow,
  DocumentKind,
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
  Field,
  Select,
  Textarea,
  toast,
  Uploader,
  type UploadControls,
  type UploadResult,
} from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRef, useState, type SyntheticEvent } from 'react';
import { fileDocument, unfileDocument } from '../../actions/documents';
import { DOCUMENT_KINDS, SENSITIVE_DOCUMENT_KINDS } from '../../screens/document-values';
import { fileTypeKey, sizeParts } from '../../screens/files';
import type { UploadLimitView } from '../companies/branding-dialog';
import { sendFile } from '../files/send-file';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { formText } from '../screens/form-data';
import { useCommand } from '../screens/use-command';

/** Which dialog the Documents section shows, with what it is about. */
export type DocumentDialogKind =
  | { kind: 'upload'; requirementKey: DocumentRequirementKey | null }
  | { kind: 'unfile'; document: DocumentDto };

interface Props {
  view: CustomerDocumentsDto;
  flow: DocumentFlow;
  limit: UploadLimitView;
  onDone: () => void;
  onCancel: () => void;
}

export function DocumentDialog({ dialog, ...props }: Props & { dialog: DocumentDialogKind }) {
  const common = useTranslations('common');
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) props.onCancel();
      }}
    >
      <DialogContent closeLabel={common('close')}>
        {dialog.kind === 'upload' ? (
          <UploadForm {...props} requirementKey={dialog.requirementKey} />
        ) : (
          <UnfileForm {...props} document={dialog.document} />
        )}
      </DialogContent>
    </Dialog>
  );
}

const FORM = 'flex flex-col gap-4';

/** The kinds a caller may file: an identity or bank paper only with documents.sensitive.read. */
function kindsFor(
  view: CustomerDocumentsDto,
  requirementKey: DocumentRequirementKey | null,
): DocumentKind[] {
  const accepted =
    requirementKey === null
      ? undefined
      : new Set(
          view.requirements
            .filter((r) => r.requirementKey === requirementKey)
            .flatMap((r) => r.acceptedKinds),
        );
  return DOCUMENT_KINDS.filter(
    (k) =>
      (accepted === undefined || accepted.has(k)) &&
      (view.canFileSensitive || !(SENSITIVE_DOCUMENT_KINDS as readonly string[]).includes(k)),
  );
}

/**
 * Upload a document: what it is and the requirement it meets are chosen first, then the file is
 * uploaded, checked and masked, and filed against this customer once its checks pass. When the
 * checks take longer, it is filed with File it once they are done.
 */
function UploadForm({
  view,
  flow,
  limit,
  onDone,
  onCancel,
  requirementKey: preset,
}: Props & { requirementKey: DocumentRequirementKey | null }) {
  const t = useTranslations('documents');
  const common = useTranslations('common');
  const files = useTranslations('files');
  const errors = useTranslations('errors');
  const [requirementKey, setRequirementKey] = useState<DocumentRequirementKey | null>(preset);
  const kinds = kindsFor(view, requirementKey);
  const [kind, setKind] = useState<DocumentKind | ''>(kinds.length === 1 ? (kinds[0] ?? '') : '');
  const [fileId, setFileId] = useState<string | undefined>();
  const recorded = useRef<string | undefined>(undefined);
  const filing = useCommand(fileDocument);
  const { fieldError, formFailure } = useFieldFailure(filing.failure, ['kind', 'requirementKey']);
  // The requirements of the flow shown, each once, in step order.
  const requirements = [
    ...new Set(view.requirements.filter((r) => r.flow === flow).map((r) => r.requirementKey)),
  ];

  const types = new Intl.ListFormat('en-IN', { type: 'disjunction' }).format(
    limit.contentTypes.flatMap((type) => {
      const key = fileTypeKey(type);
      return key === undefined ? [] : [files(`shortTypes.${key}`)];
    }),
  );
  const size = sizeParts(limit.maxBytes);
  const sizeText = files(`size.${size.unit}`, { value: size.value });

  function file(id: string, chosen: DocumentKind) {
    filing.run(
      {
        entityId: view.entityId,
        accountId: view.accountId,
        fileId: id,
        kind: chosen,
        requirementKey,
      },
      () => {
        toast.success(t('upload.filedToast'));
        onDone();
      },
    );
  }

  async function upload(chosen: File, controls: UploadControls): Promise<UploadResult> {
    recorded.current = undefined;
    setFileId(undefined);
    const result = await sendFile(
      chosen,
      { entityId: view.entityId, purpose: 'customer_document', accountId: view.accountId },
      controls,
      {
        checking: t('upload.checking'),
        checkingLong: t('upload.checkingLong'),
        ready: t('upload.ready'),
        failed: files('uploader.failed'),
        error: (key) => errors(key),
      },
      (id) => {
        recorded.current = id;
      },
    );
    const id = recorded.current;
    if (id !== undefined && !controls.signal.aborted && result.status !== 'failed') {
      setFileId(id);
      // Checked and masked: filed at once. Still being checked: File it files it once ready.
      if (result.status === 'done' && kind !== '') file(id, kind);
    }
    return result;
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (filing.pending || fileId === undefined || kind === '') return;
    file(fileId, kind);
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <DialogHeader>
        <DialogTitle>{t('upload.title')}</DialogTitle>
        <DialogDescription>{t('upload.intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="document-requirement"
        label={t('upload.requirement')}
        error={fieldError('requirementKey')}
      >
        <Select
          name="requirementKey"
          value={requirementKey ?? ''}
          disabled={fileId !== undefined}
          onChange={(e) => {
            const value = e.currentTarget.value;
            const next = requirements.find((r) => r === value) ?? null;
            setRequirementKey(next);
            const allowed = kindsFor(view, next);
            setKind(allowed.length === 1 ? (allowed[0] ?? '') : '');
          }}
        >
          <option value="">{t('upload.noRequirement')}</option>
          {requirements.map((r) => (
            <option key={r} value={r}>
              {t(`requirement.${r}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="document-kind" label={t('upload.kind')} error={fieldError('kind')}>
        <Select
          name="kind"
          value={kind}
          disabled={fileId !== undefined}
          onChange={(e) => {
            const value = e.currentTarget.value;
            setKind(kinds.find((k) => k === value) ?? '');
          }}
        >
          <option value="">{t('upload.chooseKind')}</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {t(`kind.${k}`)}
            </option>
          ))}
        </Select>
      </Field>
      {kind === '' ? (
        <p className="text-text-muted text-sm">{t('upload.chooseFirst')}</p>
      ) : (
        <Uploader
          id={`document-upload-${view.accountId}`}
          label={t('upload.file')}
          hint={`${t('upload.fileHelper')} ${files('uploader.limits', { types, size: sizeText })}`}
          accept={limit.contentTypes}
          maxBytes={limit.maxBytes}
          text={{
            choose: files('uploader.choose'),
            drop: files('uploader.drop'),
            cancel: files('uploader.cancel'),
            retry: files('uploader.retry'),
            started: files('uploader.started'),
            halfway: files('uploader.halfway'),
            cancelled: files('uploader.cancelled'),
            failed: files('uploader.failed'),
            wrongType: files('uploader.wrongType', { types }),
            tooLarge: files('uploader.tooLarge', { size: sizeText }),
            empty: files('uploader.empty'),
          }}
          upload={upload}
        />
      )}
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" pending={filing.pending} disabled={fileId === undefined}>
          {t('upload.fileIt')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Unfile a document, with the reason; it stays on the customer's record as unfiled. */
function UnfileForm({ view, onDone, onCancel, document }: Props & { document: DocumentDto }) {
  const t = useTranslations('documents');
  const common = useTranslations('common');
  const { run, pending, failure } = useCommand(unfileDocument);
  const { fieldError, formFailure } = useFieldFailure(failure, ['reason']);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const reason = formText(new FormData(e.currentTarget), 'reason');
    run({ entityId: view.entityId, documentId: document.id, reason }, () => {
      toast.success(t('unfile.unfiledToast'));
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className={FORM} noValidate>
      <DialogHeader>
        <DialogTitle>{t('unfile.title', { kind: t(`kind.${document.kind}`) })}</DialogTitle>
        <DialogDescription>{t('unfile.intro')}</DialogDescription>
      </DialogHeader>
      <Field
        id="document-unfile-reason"
        label={t('unfile.reason')}
        helper={t('unfile.reasonHelper')}
        error={fieldError('reason')}
      >
        <Textarea name="reason" rows={3} maxLength={300} required />
      </Field>
      <FailureMessage failure={formFailure} />
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          {common('cancel')}
        </Button>
        <Button type="submit" variant="danger" pending={pending}>
          {t('unfile.submitUnfile')}
        </Button>
      </DialogFooter>
    </form>
  );
}
