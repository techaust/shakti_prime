'use client';

import type { ImplementedImportKind } from '@shakti/contracts';
import { Button, Field, Select, toast, Uploader, type UploadControls } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { startImport } from '../../actions/imports';
import { sizeParts } from '../../screens/files';
import {
  formatCount,
  IMPORT_CONTENT_TYPES,
  importContentType,
  jobHref,
  limitsInWords,
  type UploadLimits,
} from '../../screens/import-wizard';
import { sendFile } from '../files/send-file';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';

/**
 * Step one of an import: the company, what the file holds and the file. The file goes straight to
 * the file store on a signed address (docs/API.md §3.2) and passes its checks; then the server
 * reads it and starts the import, and the screen opens the job. A file whose checks take longer
 * than the uploader waits is started with the button once they are done.
 */
export function UploadForm({
  companies,
  kinds,
  limits,
}: {
  companies: { id: number; name: string }[];
  kinds: readonly ImplementedImportKind[];
  limits: UploadLimits;
}) {
  const t = useTranslations('imports.upload');
  const files = useTranslations('files');
  const errors = useTranslations('errors');
  const router = useRouter();
  const start = useCommand(startImport);
  const [entityId, setEntityId] = useState<number | undefined>(
    companies.length === 1 ? companies[0]?.id : undefined,
  );
  const [kind, setKind] = useState<ImplementedImportKind>(kinds[0] ?? 'leads');
  // The uploaded file, once the server recorded it; and whether its checks are still running.
  const fileId = useRef<string | undefined>(undefined);
  const [uploaded, setUploaded] = useState<'none' | 'waiting' | 'ready'>('none');
  const words = limitsInWords(limits);
  const size = sizeParts(limits.maxFileBytes);

  function begin(company: number) {
    const id = fileId.current;
    if (id === undefined || start.pending) return;
    start.run({ entityId: company, kind, fileId: id }, (job) => {
      toast.success(
        t('done', { count: job.totalRows, shown: formatCount(job.totalRows), file: job.file.name }),
      );
      router.push(jobHref(job));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {companies.length === 1 ? null : (
          <Field id="import-company" label={t('company')} helper={t('companyHelper')}>
            <Select
              value={entityId === undefined ? '' : String(entityId)}
              disabled={uploaded !== 'none'}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setEntityId(value === '' ? undefined : Number(value));
              }}
            >
              <option value="">{t('choose')}</option>
              {companies.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="import-kind" label={t('kind')} helper={t(`kindHelpers.${kind}`)}>
          <Select
            value={kind}
            disabled={uploaded !== 'none'}
            onChange={(e) => {
              setKind(e.currentTarget.value as ImplementedImportKind);
            }}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        {entityId === undefined ? (
          <p className="text-text-muted text-sm">{t('chooseCompanyFirst')}</p>
        ) : (
          <Uploader
            key={`${String(entityId)}-${kind}`}
            id={`import-file-${String(entityId)}`}
            label={t('file')}
            hint={t('fileHelper', { megabytes: words.megabytes, rows: words.rows })}
            accept={IMPORT_CONTENT_TYPES}
            maxBytes={limits.maxFileBytes}
            typeOf={importContentType}
            text={{
              choose: files('uploader.choose'),
              drop: files('uploader.drop'),
              cancel: files('uploader.cancel'),
              retry: files('uploader.retry'),
              started: files('uploader.started'),
              halfway: files('uploader.halfway'),
              cancelled: files('uploader.cancelled'),
              failed: files('uploader.failed'),
              wrongType: errors('import_file_type'),
              tooLarge: files('uploader.tooLarge', {
                size: files(`size.${size.unit}`, { value: size.value }),
              }),
              empty: errors('import_file_empty'),
            }}
            upload={(file: File, controls: UploadControls) =>
              sendFile(
                file,
                { entityId, purpose: 'import', contentType: importContentType(file) },
                controls,
                {
                  checking: files('uploader.checking'),
                  checkingLong: t('checkingLong'),
                  ready: t('ready'),
                  failed: files('uploader.failed'),
                  error: (key) => errors(key),
                },
                (id) => {
                  fileId.current = id;
                  setUploaded('none');
                },
              )
            }
            onUploaded={(result) => {
              if (result.status === 'done') {
                setUploaded('ready');
                begin(entityId);
              } else {
                setUploaded('waiting');
              }
            }}
          />
        )}
      </div>

      <FailureMessage failure={start.failure} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" asChild>
          <Link href="/imports">{t('cancel')}</Link>
        </Button>
        {uploaded === 'none' || entityId === undefined ? null : (
          <Button
            pending={start.pending}
            onClick={() => {
              begin(entityId);
            }}
          >
            {t('submit')}
          </Button>
        )}
      </div>
    </div>
  );
}
