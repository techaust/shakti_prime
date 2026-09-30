'use client';

import type {
  DispositionDto,
  LeadSourceDto,
  PipelineSettingsViewDto,
  ScoreRuleDto,
} from '@shakti/contracts';
import { Skeleton } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { PipelineCard } from './pipeline-card';

const loading = () => <Skeleton className="h-40 w-full" />;

/** The two list editors, fetched after the pipelines so the page opens with its first section. */
const OutcomesEditor = dynamic(() => import('./outcomes-editor').then((m) => m.OutcomesEditor), {
  loading,
});
const ScoreRulesEditor = dynamic(
  () => import('./score-rules-editor').then((m) => m.ScoreRulesEditor),
  { loading },
);

export interface CompanyChoice {
  id: number;
  name: string;
}

/**
 * Settings › Pipelines: each pipeline with its stages, then the call outcomes and the lead score
 * rules, each edited for the shared scope or for one company and business line.
 */
export function PipelineSettingsScreen({
  pipelines,
  sources,
  companies,
  sharedOutcomes,
  sharedRules,
}: {
  pipelines: PipelineSettingsViewDto[];
  sources: LeadSourceDto[];
  companies: CompanyChoice[];
  sharedOutcomes: DispositionDto[];
  sharedRules: ScoreRuleDto[];
}) {
  const t = useTranslations('pipelineSettings');
  const names = Object.fromEntries(companies.map((c) => [c.id, c.name]));
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="pipelines-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="pipelines-heading" className="text-h2">
            {t('pipelines')}
          </h2>
          <p className="text-text-muted">{t('pipelinesIntro')}</p>
        </div>
        {pipelines.map((view) => (
          <PipelineCard
            key={view.pipeline.id}
            initial={view}
            companyName={
              view.pipeline.entityId === null ? undefined : names[view.pipeline.entityId]
            }
          />
        ))}
      </section>

      <section aria-labelledby="outcomes-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="outcomes-heading" className="text-h2">
            {t('outcomes')}
          </h2>
          <p className="text-text-muted">{t('outcomesIntro')}</p>
        </div>
        <OutcomesEditor companies={companies} initial={sharedOutcomes} />
      </section>

      <section aria-labelledby="scoring-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="scoring-heading" className="text-h2">
            {t('scoring')}
          </h2>
          <p className="text-text-muted">{t('scoringIntro')}</p>
        </div>
        <ScoreRulesEditor companies={companies} sources={sources} initial={sharedRules} />
      </section>
    </div>
  );
}
