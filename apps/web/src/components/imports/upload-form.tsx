'use client';

import type { IMPLEMENTED_IMPORT_KINDS } from '@shakti/contracts';
import { Button, Field, Input, Select, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type SyntheticEvent } from 'react';
import { uploadImportFile } from '../../actions/imports';
import type { ErrorKey } from '../../i18n/types';
import {
  fileProblem,
  fileSize,
  formatCount,
  jobHref,
  limitsInWords,
  type UploadLimits,
} from '../../screens/import-wizard';
import { FailureMessage, useFieldFailure } from '../screens/failure';
import { useCommand } from '../screens/use-command';

const FIELDS = ['entityId', 'kind', 'file'] as const;

/** The file reasons the upload answers, which belong under the file field. */
const FILE_REASONS: readonly string[] = [
  'import_file_empty',
  'import_file_too_large',
  'import_workbook_too_large',
  'import_file_type',
  'import_file_unreadable',
  'import_no_header',
  'import_too_many_rows',
  'import_too_many_columns',
  'import_cell_too_long',
  'import_file_duplicate',
];

/**
 * Step one of an import: the company, what the file holds and the file. The file is checked
 * against the limits here first, so a file the upload would refuse is never sent; the server
 * reads and checks it again. One idempotency key per rendered form.
 */
export function UploadForm({
  companies,
  kinds,
  limits,
}: {
  companies: { id: number; name: string }[];
  kinds: readonly (typeof IMPLEMENTED_IMPORT_KINDS)[number][];
  limits: UploadLimits;
}) {
  const t = useTranslations('imports.upload');
  const imports = useTranslations('imports');
  const errors = useTranslations('errors');
  const router = useRouter();
  const { run, pending, failure } = useCommand(uploadImportFile);
  const { fieldError, formFailure } = useFieldFailure(failure, FIELDS);
  const [file, setFile] = useState<File | undefined>();
  const [problem, setProblem] = useState<ErrorKey | 'noFile' | undefined>();
  const words = limitsInWords(limits);

  // A reason about the file itself is shown under the file field, not under the form.
  const fileFailure =
    failure !== undefined && FILE_REASONS.includes(failure.error) ? failure : undefined;
  const fileError =
    problem === 'noFile'
      ? t('noFile')
      : problem !== undefined
        ? errors(problem)
        : fileFailure !== undefined
          ? errors(fileFailure.error as ErrorKey)
          : fieldError('file');

  function choose(chosen: File | undefined) {
    setFile(chosen);
    setProblem(chosen === undefined ? undefined : fileProblem(chosen, limits));
  }

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = new FormData(e.currentTarget);
    const chosen = form.get('file');
    const found =
      chosen instanceof File && chosen.name !== '' ? fileProblem(chosen, limits) : 'noFile';
    setProblem(found);
    if (found !== undefined) return;
    run(form, (job) => {
      toast.success(
        t('done', { count: job.totalRows, shown: formatCount(job.totalRows), file: job.file.name }),
      );
      router.push(jobHref(job));
    });
  }

  const size = file === undefined ? undefined : fileSize(file.size);
  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-4">
        {companies.length === 1 ? (
          <input type="hidden" name="entityId" value={String(companies[0]?.id ?? '')} />
        ) : (
          <Field
            id="import-company"
            label={t('company')}
            helper={t('companyHelper')}
            error={fieldError('entityId')}
          >
            <Select name="entityId" required defaultValue="">
              <option value="">{t('choose')}</option>
              {companies.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field id="import-kind" label={t('kind')} error={fieldError('kind')}>
          <Select name="kind" required defaultValue={kinds[0]}>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(`kinds.${kind}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="import-file"
          label={t('file')}
          helper={t('fileHelper', { megabytes: words.megabytes, rows: words.rows })}
          error={fileError}
        >
          <Input
            name="file"
            type="file"
            required
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="file:text-text file:bg-surface-2 file:border-border h-auto py-1.5 file:mr-3 file:rounded-sm file:border file:px-2 file:py-1 max-md:h-auto"
            onChange={(e) => {
              choose(e.currentTarget.files?.[0]);
            }}
          />
        </Field>
        {file === undefined || size === undefined ? null : (
          <p className="text-text-muted text-sm break-all">
            {t('chosen', { name: file.name, size: imports(`fileSize.${size.unit}`, size) })}
          </p>
        )}
      </div>

      <FailureMessage failure={fileFailure === undefined ? formFailure : undefined} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" asChild>
          <Link href="/imports">{t('cancel')}</Link>
        </Button>
        <Button type="submit" pending={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
