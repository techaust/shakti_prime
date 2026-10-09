import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { listTeamQueues } from '../../../actions/calling';
import {
  homeCaller,
  homeCredit,
  homePipeline,
  homeResponseTimes,
  homeSales,
} from '../../../actions/home';
import { myProgress, teamProgress } from '../../../actions/targets';
import {
  AccountsSection,
  CallerSection,
  ExecutiveSection,
  LeadSection,
  ManagerSection,
} from '../../../components/home/sections';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import type { RoleNameKey } from '../../../i18n/types';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { TARGET_METRICS } from '../../../screens/contract-values';
import { homeSections, periodParam, sectionEntities, type HomeSection } from '../../../screens/home';
import { visibleNav } from '../../../screens/menu-access';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('home'), (await getTranslations('auth.home'))('title'));
}

type Companies = Record<number, string>;

/** The caller's queue and targets; a failed read shows its sentence in the section's place. */
async function CallerPart({
  companies,
  entityIds,
}: {
  companies: Companies;
  entityIds: readonly number[];
}) {
  const [queue, progress] = await Promise.all([homeCaller(entityIds), myProgress(entityIds)]);
  if (!queue.ok || !progress.ok) return <FailureMessage failure={firstFailure(queue, progress)} />;
  return <CallerSection queue={queue.data} progress={progress.data} companies={companies} />;
}

/**
 * The team lead's team progress, leaderboard and queues, one company at a time: a team is the
 * lead's team in one company, so each read acts in that company.
 */
async function LeadPart({
  companies,
  entityIds,
  period,
  metric,
}: {
  companies: Companies;
  entityIds: readonly number[];
  period: ReturnType<typeof periodParam>;
  metric: (typeof TARGET_METRICS)[number];
}) {
  const results = await Promise.all(
    entityIds.map(async (entityId) => ({
      teams: await teamProgress({ entityId, period, metric }),
      queues: await listTeamQueues({ entityId }),
    })),
  );
  const failed = firstFailure(...results.flatMap((r) => [r.teams, r.queues]));
  if (failed !== undefined) return <FailureMessage failure={failed} />;
  return (
    <LeadSection
      teams={results.flatMap((r) => (r.teams.ok ? r.teams.data : []))}
      queues={results.flatMap((r) => (r.queues.ok ? r.queues.data : []))}
      period={period}
      metric={metric}
      companies={companies}
    />
  );
}

/** The General Manager's first-call response times and pipeline. */
async function ManagerPart({
  companies,
  entityIds,
}: {
  companies: Companies;
  entityIds: readonly number[];
}) {
  const [response, pipelines] = await Promise.all([
    homeResponseTimes(entityIds),
    homePipeline(entityIds),
  ]);
  if (!response.ok || !pipelines.ok) {
    return <FailureMessage failure={firstFailure(response, pipelines)} />;
  }
  return (
    <ManagerSection response={response.data} pipelines={pipelines.data} companies={companies} />
  );
}

/** Accounts' dealer credit. */
async function AccountsPart({
  companies,
  entityIds,
}: {
  companies: Companies;
  entityIds: readonly number[];
}) {
  const credit = await homeCredit(entityIds);
  if (!credit.ok) return <FailureMessage failure={firstFailure(credit)} />;
  return <AccountsSection credit={credit.data} companies={companies} />;
}

/** The Executive's quotes, orders and pipeline. */
async function ExecutivePart({
  companies,
  entityIds,
}: {
  companies: Companies;
  entityIds: readonly number[];
}) {
  const [sales, pipelines] = await Promise.all([homeSales(entityIds), homePipeline(entityIds)]);
  if (!sales.ok || !pipelines.ok) {
    return <FailureMessage failure={firstFailure(sales, pipelines)} />;
  }
  return <ExecutiveSection sales={sales.data} pipelines={pipelines.data} companies={companies} />;
}

/**
 * The landing inside the shell: who you are, in which role and company, what your role works on
 * (the caller's queue and targets, the team lead's team, the General Manager's and Executive's
 * overview, Accounts' dealer credit; docs/03-roadmap-appendix/phase1.md §9) and a shortcut to every
 * screen your grants open (the same list as the sidebar). A person with several roles sees the
 * sections of each. The theme and the password change live on the profile screen.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access } = await screenAccess(navRequires('home'));
  const query = await searchParams;
  const t = await getTranslations('home');
  const auth = await getTranslations('auth.home');
  const nav = await getTranslations('nav');
  const roles = await getTranslations('roles');
  const active =
    principal.entityIds.length === 1
      ? access.entities.find((e) => e.entityId === principal.entityIds[0])
      : undefined;
  const shortcuts = visibleNav(principal.permissions).filter((item) => item.id !== 'home');
  const companies = companyNames(access);
  const viewed = access.entities.filter((e) => principal.entityIds.includes(e.entityId));
  const held = homeSections(viewed.map((e) => e.roleKey));
  const entitiesOf = (section: HomeSection) => sectionEntities(viewed, section);
  const period = periodParam(query.period);
  const metricParam = typeof query.metric === 'string' ? query.metric : undefined;
  const metric = TARGET_METRICS.find((m) => m === metricParam) ?? 'calls';
  const part: Record<HomeSection, React.ReactNode> = {
    caller: <CallerPart companies={companies} entityIds={entitiesOf('caller')} />,
    lead: (
      <LeadPart companies={companies} entityIds={entitiesOf('lead')} period={period} metric={metric} />
    ),
    manager: <ManagerPart companies={companies} entityIds={entitiesOf('manager')} />,
    accounts: <AccountsPart companies={companies} entityIds={entitiesOf('accounts')} />,
    executive: <ExecutivePart companies={companies} entityIds={entitiesOf('executive')} />,
  };
  return (
    <Page
      width="detail"
      title={t('greeting', { name: access.name })}
      description={
        <>
          {/* A signed-in person always holds a staff role; agents never sign in here. */}
          <span className="block">
            {auth('role', { role: roles(principal.roleKey as RoleNameKey) })}
          </span>
          <span className="block">
            {active === undefined
              ? t('allCompanies')
              : t('company', { company: active.entityName })}
          </span>
        </>
      }
    >
      {held.map((section) => (
        <div key={section} className="flex flex-col gap-6">
          {part[section]}
        </div>
      ))}
      <section aria-labelledby="home-shortcuts" className="flex flex-col gap-3">
        <h2 id="home-shortcuts" className="text-h3">
          {t('shortcutsTitle')}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="bg-surface border-border hover:border-border-strong hover:bg-surface-2 flex h-full items-start gap-3 rounded-lg border p-4 transition-colors duration-(--motion-fast) ease-out"
                >
                  <span
                    aria-hidden
                    className="bg-accent-soft text-accent inline-flex size-8 shrink-0 items-center justify-center rounded-md"
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-semibold">{nav(item.label)}</span>
                    <span className="text-text-muted text-sm">
                      {t(`hint.${item.label as Exclude<typeof item.label, 'home'>}`)}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </Page>
  );
}
