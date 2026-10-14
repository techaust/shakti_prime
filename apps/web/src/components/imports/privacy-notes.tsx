'use client';

import type { ImportJobDto } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatDateTime } from '../../screens/format';
import { formatCount } from '../../screens/import-wizard';

/**
 * What the import did not keep (audit SEC-1): the columns of Aadhaar numbers it left out, the
 * Aadhaar numbers it hid in other columns, the uploaded file once it was deleted, and what the
 * rows said once it was cleared. Nothing shows for an import with none of these.
 */
export function PrivacyNotes({ job }: { job: ImportJobDto }) {
  const t = useTranslations('imports.privacy');
  const notes: string[] = [];
  if (job.leftOutColumns.length > 0) {
    notes.push(
      t('leftOut', {
        count: job.leftOutColumns.length,
        columns: job.leftOutColumns.map((c) => `“${c}”`).join(', '),
      }),
    );
  }
  if (job.maskedValues > 0) {
    notes.push(t('masked', { count: job.maskedValues, shown: formatCount(job.maskedValues) }));
  }
  if (job.file.deletedAt !== null) {
    notes.push(t('fileDeleted', { date: formatDateTime(job.file.deletedAt) }));
  }
  if (job.purgedAt !== null) {
    notes.push(t('purged', { date: formatDateTime(job.purgedAt) }));
  }
  if (notes.length === 0) return null;
  return (
    <section
      aria-labelledby="import-privacy-title"
      className="border-border bg-surface-2 flex flex-col gap-2 rounded-lg border p-4"
    >
      <h2 id="import-privacy-title" className="text-h3">
        {t('title')}
      </h2>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </section>
  );
}

/** An import left before its rows were added, whose rows were cleared: start again. */
export function PurgedPanel() {
  const t = useTranslations('imports.privacy');
  return (
    <section
      aria-labelledby="import-step-title"
      className="border-border bg-surface flex flex-col gap-4 rounded-lg border p-4 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="import-step-title" className="text-h2">
          {t('purgedTitle')}
        </h2>
        <p className="text-text-muted">{t('purgedIntro')}</p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild>
          <Link href="/imports/new">{t('uploadAgain')}</Link>
        </Button>
      </div>
    </section>
  );
}
