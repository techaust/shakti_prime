import { hasGrant, type ProjectViewDto } from '@shakti/contracts';
import { Button, StatusBadge } from '@shakti/ui';
import type { Metadata, Route } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getProject } from '../../../../../actions/projects';
import { MilestonesPanel } from '../../../../../components/projects/milestones-panel';
import { ProjectActions } from '../../../../../components/projects/project-actions';
import { FailureMessage } from '../../../../../components/screens/failure';
import { Page } from '../../../../../components/shell/page';
import { navRequires } from '../../../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../../../screens/access';
import { customerHref } from '../../../../../screens/customers';
import { orderHref } from '../../../../../screens/orders';
import {
  PROJECT_STATE_TONE,
  PROJECT_TABS,
  projectHref,
  projectTab,
  type ProjectTab,
} from '../../../../../screens/projects';
import { firstFailure } from '../../../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface Params {
  entityId: string;
  projectId: string;
}

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('projects'), (await getTranslations('projects'))('title'));
}

interface PanelProps {
  view: ProjectViewDto;
  names: Readonly<Record<string, string>>;
  canStep: boolean;
}

/**
 * Each tab's panel, by the tab's key (`PROJECT_TABS`). A later slice adds its panel here, one line
 * each, beside its tab.
 */
const TAB_PANELS: Record<ProjectTab, (props: PanelProps) => ReactNode> = {
  milestones: ({ view, names, canStep }) => (
    <MilestonesPanel
      entityId={view.project.entityId}
      projectId={view.project.id}
      milestones={view.project.milestones}
      names={names}
      canStep={canStep}
    />
  ),
};

/**
 * One project (docs/03-roadmap-appendix/phase4.md §6.1, PRD PRJ-01): its header (status, customer,
 * order, business line, scheme, project manager and people), the moves a manager of the company
 * may make, and its tabs, of which this slice builds Steps. A project the caller may not read, or
 * an address that names none, shows the not-found screen.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access } = await screenAccess(navRequires('projects'));
  const [{ entityId: rawEntityId, projectId }, query] = await Promise.all([params, searchParams]);
  const entityId = Number(rawEntityId);
  if (!Number.isInteger(entityId) || entityId < 1 || entityId > 32_767 || !UUID.test(projectId)) {
    notFound();
  }
  if (!principal.entityIds.includes(entityId)) notFound();
  const result = await getProject({ entityId, projectId });
  if (!result.ok && ['project_missing', 'forbidden'].includes(result.error)) notFound();
  const t = await getTranslations('projects');
  if (!result.ok) {
    return (
      <Page
        title={t('title')}
        width="detail"
        actions={
          <Button asChild variant="secondary">
            <Link href="/projects">{t('page.back')}</Link>
          </Button>
        }
      >
        <FailureMessage failure={firstFailure(result)} />
      </Page>
    );
  }
  const view = result.data;
  const { project } = view;
  const names = Object.fromEntries(view.people.map((p) => [p.id, p.name]));
  const manages = hasGrant(principal.permissions, 'projects.write', 'entity');
  const onIt = project.ownerId === principal.id || project.assigneeIds.includes(principal.id);
  const canStep =
    project.state === 'active' &&
    project.flow === 'standard' &&
    (manages || (hasGrant(principal.permissions, 'projects.write', 'own') && onIt));
  const tab = projectTab(typeof query.tab === 'string' ? query.tab : undefined);
  const isOpen = (key: string) => key === tab;
  const company = companyNames(access)[entityId] ?? '';
  const place =
    view.village === null
      ? null
      : view.district === null
        ? view.village
        : t('page.place', { village: view.village, district: view.district });

  return (
    <Page
      width="detail"
      title={project.projectNo}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={PROJECT_STATE_TONE[project.state]}>
            {t(`states.${project.state}`)}
          </StatusBadge>
          {view.customerName === null ? (
            <span>{t('noCustomer')}</span>
          ) : hasGrant(principal.permissions, 'crm.account.read', 'entity') ? (
            <Link
              href={customerHref(project.accountId, entityId)}
              className="text-accent-text hover:underline"
            >
              {view.customerName}
            </Link>
          ) : (
            <span>{view.customerName}</span>
          )}
          {place === null ? null : <span className="text-text-muted">{place}</span>}
          <span className="text-text-muted">{company}</span>
        </span>
      }
      actions={
        <>
          <Button asChild variant="secondary">
            <Link href="/projects">{t('page.back')}</Link>
          </Button>
          {manages ? (
            <ProjectActions
              project={{
                entityId,
                id: project.id,
                projectNo: project.projectNo,
                state: project.state,
                flow: project.flow,
                ownerId: project.ownerId,
                assigneeIds: project.assigneeIds,
                stepsDone: project.milestones.every((m) => m.state !== 'open'),
              }}
            />
          ) : null}
        </>
      }
    >
      <dl className="border-border bg-surface grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('columns.segment')}>{t(`segments.${project.segment}`)}</Fact>
        <Fact label={t('page.scheme')}>{t(`schemes.${project.scheme}`)}</Fact>
        <Fact label={t('page.owner')}>
          {project.ownerId === null
            ? t('page.ownerNone')
            : (names[project.ownerId] ?? t('page.ownerNone'))}
        </Fact>
        <Fact label={t('page.people')}>
          {project.assigneeIds.length === 0
            ? t('page.peopleNone')
            : project.assigneeIds.map((id) => names[id] ?? '').join(', ')}
        </Fact>
        {view.soNo === null ? null : (
          <Fact label={t('page.orderLabel')}>
            <Link
              href={orderHref(entityId, project.salesOrderId)}
              className="text-accent-text hover:underline"
            >
              {view.soNo}
            </Link>
          </Fact>
        )}
      </dl>
      {project.holdReason === null ? null : (
        <p role="status" className="text-text-muted">
          {t('page.holdReason', { reason: project.holdReason })}
        </p>
      )}
      {project.cancelReason === null ? null : (
        <p role="status" className="text-text-muted">
          {t('page.cancelReason', { reason: project.cancelReason })}
        </p>
      )}
      {project.flow === 'surya_ghar' ? (
        <p className="text-text-muted">{t('page.suryaGhar')}</p>
      ) : null}
      <nav aria-label={t('tabs.label')} className="border-border flex gap-1 border-b">
        {PROJECT_TABS.map((key) => (
          <Link
            key={key}
            href={`${projectHref(entityId, project.id)}?tab=${key}` as Route}
            aria-current={isOpen(key) ? 'page' : undefined}
            className={
              isOpen(key)
                ? 'border-accent text-text -mb-px border-b-2 px-3 py-2 font-medium'
                : 'text-text-muted hover:text-text px-3 py-2'
            }
          >
            {t(`tabs.${key}`)}
          </Link>
        ))}
      </nav>
      {TAB_PANELS[tab]({ view, names, canStep })}
    </Page>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-text-muted text-sm">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
