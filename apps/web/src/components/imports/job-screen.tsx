'use client';

import type {
  ImportJobDto,
  ImportRowPage,
  ImportTemplateDto,
  LeadSourceDto,
} from '@shakti/contracts';
import { StatusBadge } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { formatDateTime } from '../../screens/format';
import { formatCount, JOB_STATE_TONE, type RowView } from '../../screens/import-wizard';
import { CheckPanel, CommitPanel, OutcomePanel, ProgressPanel } from './job-panels';
import { ImportSteps } from './import-steps';
import { MapStep, type PipelineChoice } from './map-step';
import { RowsGrid } from './rows-grid';

/**
 * One import at the step it waits at. Every change is a command; after it the page is read again
 * and this screen starts afresh from the job's new state (the page keys it by state and time).
 */
export function JobScreen({
  job,
  company,
  templates,
  topRow,
  pipelines,
  sources,
  initialRows,
  initialView,
  batchSize,
}: {
  job: ImportJobDto;
  company: string;
  templates: ImportTemplateDto[];
  topRow: Record<string, string>;
  pipelines: PipelineChoice[];
  sources: LeadSourceDto[];
  initialRows: ImportRowPage;
  initialView: RowView;
  batchSize: number;
}) {
  const t = useTranslations('imports');
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [remapping, setRemapping] = useState(false);
  const refresh = useCallback(() => {
    startRefresh(() => {
      router.refresh();
    });
  }, [router]);

  const mapping = job.state === 'uploaded' || remapping;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge tone={JOB_STATE_TONE[job.state]}>{t(`state.${job.state}`)}</StatusBadge>
          <p className="text-text-muted text-sm">
            {t('job.meta', {
              company,
              count: job.totalRows,
              shown: formatCount(job.totalRows),
              date: formatDateTime(job.createdAt),
            })}
          </p>
        </div>
        <ImportSteps state={mapping ? 'uploaded' : job.state} />
      </div>

      {mapping ? (
        <MapStep
          job={job}
          templates={templates}
          topRow={topRow}
          pipelines={pipelines}
          sources={sources}
          refreshing={refreshing}
          onCancel={
            job.state === 'uploaded'
              ? undefined
              : () => {
                  setRemapping(false);
                }
          }
          onDone={refresh}
        />
      ) : job.state === 'mapped' ? (
        <CheckPanel
          job={job}
          refreshing={refreshing}
          onRemap={() => {
            setRemapping(true);
          }}
          onDone={refresh}
        />
      ) : (
        <>
          {job.state === 'previewed' ? (
            <CommitPanel
              job={job}
              refreshing={refreshing}
              onRemap={() => {
                setRemapping(true);
              }}
              onDone={refresh}
            />
          ) : job.state === 'committing' ? (
            <ProgressPanel job={job} refreshing={refreshing} onChanged={refresh} />
          ) : (
            <OutcomePanel job={job} batchSize={batchSize} onDone={refresh} />
          )}
          {job.state === 'committing' ? null : (
            <RowsGrid job={job} initial={initialRows} initialView={initialView} />
          )}
        </>
      )}
    </div>
  );
}
