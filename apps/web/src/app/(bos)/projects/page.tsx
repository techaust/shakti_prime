import { hasGrant } from '@shakti/contracts';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { listProjectFilters, listProjects } from '../../../actions/projects';
import { ProjectsScreen, type ProjectFilters } from '../../../components/projects/projects-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { PROJECT_SEGMENTS, PROJECT_STATES } from '../../../screens/contract-values';
import { companyParam } from '../../../screens/customers';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STEP_KEY = /^[a-z][a-z0-9_]{0,39}$/;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('projects'), (await getTranslations('projects'))('title'));
}

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function oneOf<T extends string>(list: readonly T[], value: string | undefined): T | undefined {
  return value !== undefined && (list as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Projects (docs/03-roadmap-appendix/phase4.md §6.1): one company's projects, the one being viewed
 * or the one chosen with `?company=`; `state`, `segment`, `owner` and `step` filter the list. A
 * Field Engineer or a Lead Converter sees the projects they are on or own.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, activeEntityId } = await screenAccess(navRequires('projects'));
  const query = await searchParams;
  const asked = companyParam(query.company);
  if (asked !== undefined && !principal.entityIds.includes(asked)) notFound();
  const entityId = asked ?? activeEntityId ?? principal.entityIds[0];
  if (entityId === undefined) notFound();
  const owner = one(query.owner);
  const step = one(query.step);
  const filters: ProjectFilters = {
    state: oneOf(PROJECT_STATES, one(query.state)),
    segment: oneOf(PROJECT_SEGMENTS, one(query.segment)),
    ownerId: owner !== undefined && UUID.test(owner) ? owner : undefined,
    step: step !== undefined && STEP_KEY.test(step) ? step : undefined,
  };
  const t = await getTranslations('projects');
  const names = companyNames(access);
  const [choices, page] = await Promise.all([
    listProjectFilters({ entityId }),
    listProjects({
      entityId,
      limit: 50,
      ...(filters.state ? { state: filters.state } : {}),
      ...(filters.segment ? { segment: filters.segment } : {}),
      ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      ...(filters.step ? { step: filters.step } : {}),
    }),
  ]);
  return (
    <Page title={t('title')} description={t('intro')}>
      {page.ok && choices.ok ? (
        <ProjectsScreen
          key={`${String(entityId)}/${JSON.stringify(filters)}`}
          initial={page.data}
          entityId={entityId}
          choices={choices.data}
          filters={filters}
          ownOnly={!hasGrant(principal.permissions, 'projects.read', 'entity')}
          companies={Object.fromEntries(
            principal.entityIds.map((id) => [id, names[id] ?? String(id)]),
          )}
        />
      ) : (
        <FailureMessage failure={firstFailure(page, choices)} />
      )}
    </Page>
  );
}
