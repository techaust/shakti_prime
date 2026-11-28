import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { listProjectTemplates } from '../../../../actions/projects';
import { StepsScreen } from '../../../../components/projects/steps-screen';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { navRequires } from '../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../screens/access';
import { companyParam } from '../../../../screens/customers';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(
    navRequires('settings-project-steps'),
    (await getTranslations('projectSteps'))('title'),
  );
}

/**
 * Settings › Project steps (docs/03-roadmap-appendix/phase4.md §6.1, question 2 (a),
 * `projects.write` for every company): each business line's current steps for one company, the
 * one being viewed or chosen with `?company=`, and a new version published by the Executive.
 */
export default async function ProjectStepsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const screen = await screenAccess(navRequires('settings-project-steps'));
  const { principal, access, activeEntityId } = screen;
  const asked = companyParam((await searchParams).company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const t = await getTranslations('projectSteps');
  const templates = await listProjectTemplates({ entityId });
  const names = companyNames(access);
  return (
    <Page title={t('title')} description={t('intro')} width="detail">
      {templates.ok ? (
        <StepsScreen
          key={entityId}
          entityId={entityId}
          initial={templates.data}
          companies={Object.fromEntries(
            principal.entityIds.map((id) => [id, names[id] ?? String(id)]),
          )}
        />
      ) : (
        <FailureMessage failure={firstFailure(templates)} />
      )}
    </Page>
  );
}
