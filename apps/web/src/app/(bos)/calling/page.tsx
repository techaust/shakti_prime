import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { listCallQueue, listTeamQueues, loadCallLead } from '../../../actions/calling';
import { CallingScreen } from '../../../components/calling/calling-screen';
import { TeamQueues } from '../../../components/calling/team-queues';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { companyParam } from '../../../screens/customers';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('calling'), (await getTranslations('calling'))('title'));
}

/** My queue or My team, for a caller who may see the team's queues. */
async function ViewSwitch({ current }: { current: 'queue' | 'team' }) {
  const t = await getTranslations('calling');
  const link = (view: 'queue' | 'team') => (
    <Button asChild variant={current === view ? 'secondary' : 'ghost'}>
      <Link
        href={view === 'queue' ? '/calling' : '/calling?view=team'}
        aria-current={current === view ? 'page' : undefined}
      >
        {view === 'queue' ? t('myQueue') : t('myTeam')}
      </Link>
    </Button>
  );
  return (
    <nav aria-label={t('viewLabel')} className="flex items-center gap-1">
      {link('queue')}
      {link('team')}
    </nav>
  );
}

/**
 * Calling (`/calling`, PRD TEL-01, docs/03-roadmap-appendix/phase1.md §7.2): the caller's queue and the
 * workspace, opened on the first lead of the queue. A team lead (`calls.log` at team scope or
 * wider) also has My team, the team's queues, and opens a caller's queue from there
 * (`?caller=<id>&company=<id>`).
 */
export default async function CallingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, can } = await screenAccess(navRequires('calling'));
  const query = await searchParams;
  const t = await getTranslations('calling');
  const canTeam = can('calls.log', 'team');
  const team = canTeam && query.view === 'team';
  const callerParam = typeof query.caller === 'string' ? query.caller : undefined;
  const callerId =
    canTeam && callerParam !== undefined && UUID.test(callerParam) && callerParam !== principal.id
      ? callerParam
      : undefined;
  const entityId = callerId === undefined ? undefined : companyParam(query.company);
  const actions = canTeam ? <ViewSwitch current={team ? 'team' : 'queue'} /> : undefined;

  if (team) {
    const rows = await listTeamQueues({});
    return (
      <Page title={t('title')} description={t('teamIntro')} actions={actions}>
        {rows.ok ? (
          <TeamQueues
            rows={rows.data}
            companies={companyNames(access)}
            showCompany={principal.entityIds.length > 1}
          />
        ) : (
          <FailureMessage failure={firstFailure(rows)} />
        )}
      </Page>
    );
  }

  const [queue, members] = await Promise.all([
    listCallQueue({
      limit: 50,
      ...(callerId === undefined ? {} : { callerId }),
      ...(entityId === undefined ? {} : { entityId }),
    }),
    callerId === undefined ? undefined : listTeamQueues({}),
  ]);
  const first = queue.ok ? queue.data.items[0] : undefined;
  const lead =
    first === undefined
      ? undefined
      : await loadCallLead({ entityId: first.entityId, opportunityId: first.opportunityId });
  const callerName =
    members?.ok === true
      ? members.data.find((m) => m.callerId === callerId)?.callerName
      : undefined;
  return (
    <Page
      title={callerName === undefined ? t('title') : t('viewing', { name: callerName })}
      description={t('intro')}
      actions={
        callerId === undefined ? (
          actions
        ) : (
          <Button asChild variant="secondary">
            <Link href="/calling?view=team">{t('backToTeam')}</Link>
          </Button>
        )
      }
    >
      {queue.ok ? (
        <CallingScreen
          initialQueue={queue.data}
          initialLead={lead?.ok === true ? lead.data : null}
          {...(callerId === undefined ? {} : { callerId })}
        />
      ) : (
        <FailureMessage failure={firstFailure(queue)} />
      )}
    </Page>
  );
}
