import { IMPORT_LIMITS } from '@shakti/contracts';
import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { leadFormOptions } from '../../../../../actions/crm';
import { getImportJob, listImportRows, listImportTemplates } from '../../../../../actions/imports';
import type { ActionResult } from '../../../../../actions/result';
import { JobScreen } from '../../../../../components/imports/job-screen';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { companyNames, screenAccess } from '../../../../../screens/access';
import { navRequires } from '../../../../../nav';
import { initialRowView, rowStateOf } from '../../../../../screens/import-wizard';
import { pipelinesFor } from '../../../../../screens/lead-form';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Params {
  entityId: string;
  jobId: string;
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('imports'))('title') };
}

/** The answer a read gives when it is not needed for this state of the job. */
const notNeeded = <T,>(data: T): Promise<ActionResult<T>> => Promise.resolve({ ok: true, data });

/**
 * One import, at the step it waits at (docs/design/backend-weeks-3-5.md §8): matching the
 * columns, checking the rows, adding them and, once added, undoing them. The page reads what the
 * step needs; after each change the screen asks for the page again.
 */
export default async function ImportJobPage({ params }: { params: Promise<Params> }) {
  const { access } = await screenAccess(navRequires('imports'));
  const { entityId: rawEntityId, jobId } = await params;
  const entityId = Number(rawEntityId);
  if (!Number.isInteger(entityId) || entityId < 1 || entityId > 32_767 || !UUID.test(jobId)) {
    notFound();
  }
  const t = await getTranslations('imports');
  const back = (
    <Button variant="secondary" asChild>
      <Link href="/imports">{t('job.back')}</Link>
    </Button>
  );

  const found = await getImportJob({ entityId, jobId });
  if (!found.ok) {
    // Another company's job, or one that never existed, reads the same (docs/SECURITY.md §3).
    const missing = ['not_found', 'forbidden', 'validation_failed'].includes(found.error);
    return (
      <Page title={t('title')} actions={back} width="detail">
        <FailureMessage
          failure={missing ? { error: 'import_job_missing', attempt: 0 } : firstFailure(found)}
        />
      </Page>
    );
  }
  const job = found.data;
  const canMap = job.state === 'uploaded' || job.state === 'mapped' || job.state === 'previewed';
  const view = initialRowView(job);
  const state = rowStateOf(view);
  const [templates, top, options, rows] = await Promise.all([
    canMap ? listImportTemplates({ entityId, kind: job.kind }) : notNeeded([]),
    canMap
      ? listImportRows({ entityId, jobId, limit: 1 })
      : notNeeded({ rows: [], nextAfter: null, customers: {} }),
    canMap ? leadFormOptions() : notNeeded({ pipelines: [], sources: [] }),
    job.state === 'uploaded' || job.state === 'mapped'
      ? notNeeded({ rows: [], nextAfter: null, customers: {} })
      : listImportRows({ entityId, jobId, limit: 50, ...(state === undefined ? {} : { state }) }),
  ]);

  return (
    <Page title={t('job.title', { file: job.file.name })} actions={back} width="detail">
      {templates.ok && top.ok && options.ok && rows.ok ? (
        <JobScreen
          // A fresh page for each change of the job, so every step starts from what was read.
          key={`${job.state}-${job.updatedAt}`}
          job={job}
          company={companyNames(access)[job.entityId] ?? ''}
          templates={templates.data}
          topRow={top.data.rows[0]?.raw ?? {}}
          pipelines={pipelinesFor(options.data.pipelines, job.entityId).map((p) => ({
            key: p.key,
            name: p.name,
          }))}
          sources={options.data.sources}
          initialRows={rows.data}
          initialView={view}
          batchSize={IMPORT_LIMITS.batchSize}
        />
      ) : (
        <FailureMessage failure={firstFailure(templates, top, options, rows)} />
      )}
    </Page>
  );
}
