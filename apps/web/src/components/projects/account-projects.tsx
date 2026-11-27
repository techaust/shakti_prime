import type { ProjectRowDto } from '@shakti/contracts';
import { StatusBadge } from '@shakti/ui';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PROJECT_STATE_TONE, projectHref } from '../../screens/projects';
import { DEFAULT_PROJECT_STEPS } from '../../screens/contract-values';
import { isOneOf } from '../../screens/customers';
import { wordsOf } from '../../screens/audit';

/**
 * Account 360's Projects (docs/03-roadmap-appendix/phase4.md §6.1): the customer's projects in the
 * company shown, newest first, each opening its project page with its status and current step.
 * Rendered on the server for a caller holding `projects.read`.
 */
export async function AccountProjects({ projects }: { projects: readonly ProjectRowDto[] }) {
  const t = await getTranslations('projects');
  const step = (r: ProjectRowDto) =>
    r.flow === 'surya_ghar'
      ? t('suryaGharStep')
      : r.stepKey === null
        ? t('noStep')
      : (r.stepTitle ??
        (isOneOf(DEFAULT_PROJECT_STEPS, r.stepKey)
          ? t(`defaultSteps.${r.stepKey}`)
          : wordsOf(r.stepKey)));
  return (
    <section
      aria-labelledby="account-projects"
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <h2 id="account-projects" className="text-h3">
        {t('account.sectionTitle')}
      </h2>
      {projects.length === 0 ? (
        <p className="text-text-muted">{t('account.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {projects.map((r) => (
            <li key={r.id} className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={projectHref(r.entityId, r.id)}
                  className="text-accent-text font-medium tabular-nums hover:underline"
                >
                  {r.projectNo}
                </Link>
                <StatusBadge tone={PROJECT_STATE_TONE[r.state]}>
                  {t(`states.${r.state}`)}
                </StatusBadge>
              </div>
              <span className="text-text-muted text-sm">
                {t(`segments.${r.segment}`)} · {step(r)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
