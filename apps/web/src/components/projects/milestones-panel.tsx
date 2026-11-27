'use client';

import type { ProjectMilestoneDto } from '@shakti/contracts';
import { Button, StatusBadge, toast } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { completeMilestone } from '../../actions/projects';
import { formatDate } from '../../screens/format';
import { FailureMessage } from '../screens/failure';
import { useCommand } from '../screens/use-command';
import { useStepName } from './use-step-name';

/**
 * The project's Steps tab (PRD PRJ-01): the copied checklist in order, each done step with when and
 * by whom, and the next open one with Mark done for a person who writes the project (a manager of
 * the company, or the engineer on it while it is in progress).
 */
export function MilestonesPanel({
  entityId,
  projectId,
  milestones,
  names,
  canStep,
}: {
  entityId: number;
  projectId: string;
  milestones: readonly ProjectMilestoneDto[];
  /** The people the steps name, by id. */
  names: Readonly<Record<string, string>>;
  canStep: boolean;
}) {
  const t = useTranslations('projects.milestones');
  const stepName = useStepName();
  const router = useRouter();
  const { run, pending, failure } = useCommand(completeMilestone);
  const next = milestones.find((m) => m.state === 'open');

  if (milestones.length === 0) return <p className="text-text-muted">{t('empty')}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-muted text-sm">{t('intro')}</p>
      <FailureMessage failure={failure} />
      <ol className="border-border bg-surface flex flex-col rounded-lg border">
        {milestones.map((m) => {
          const isNext = m.id === next?.id;
          const by = m.doneBy === null ? undefined : names[m.doneBy];
          return (
            <li
              key={m.id}
              className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">
                  <span className="text-text-muted tabular-nums">{`${String(m.position)}. `}</span>
                  {stepName(m)}
                </span>
                <span
                  className="text-text-muted text-sm"
                  data-dynamic={m.state === 'done' ? true : undefined}
                >
                  {m.state === 'done' && m.doneAt !== null
                    ? by === undefined
                      ? t('doneNoName', { date: formatDate(m.doneAt) })
                      : t('done', { date: formatDate(m.doneAt), name: by })
                    : m.state === 'skipped'
                      ? t('skipped')
                      : isNext
                        ? t('next')
                        : t('open')}
                </span>
              </div>
              {m.state === 'done' ? (
                <StatusBadge tone="success">{t('doneBadge')}</StatusBadge>
              ) : isNext && canStep ? (
                <Button
                  size="sm"
                  pending={pending}
                  onClick={() => {
                    run({ entityId, projectId, milestoneKey: m.key }, () => {
                      toast.success(t('markedDone'));
                      router.refresh();
                    });
                  }}
                >
                  {t('markDone')}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
