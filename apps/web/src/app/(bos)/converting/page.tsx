import { Button } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { listTeamQueues } from '../../../actions/calling';
import { loadConvertingBoard } from '../../../actions/converting';
import { ConvertingScreen } from '../../../components/converting/converting-screen';
import { FailureMessage } from '../../../components/screens/failure';
import { Page } from '../../../components/shell/page';
import { navRequires } from '../../../nav';
import { companyNames, screenAccess, screenTitle } from '../../../screens/access';
import { boardInput, converterHref } from '../../../screens/converting';
import { companyParam } from '../../../screens/customers';
import { firstFailure } from '../../../screens/result';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  return screenTitle(navRequires('converting'), (await getTranslations('converting'))('pageTitle'));
}

/** My leads or My team, for a person who may see the team's leads. */
async function ViewSwitch({ current }: { current: 'mine' | 'team' }) {
  const t = await getTranslations('converting');
  const link = (view: 'mine' | 'team') => (
    <Button asChild variant={current === view ? 'secondary' : 'ghost'}>
      <Link
        href={view === 'mine' ? '/converting' : '/converting?view=team'}
        aria-current={current === view ? 'page' : undefined}
      >
        {view === 'mine' ? t('myLeads') : t('myTeam')}
      </Link>
    </Button>
  );
  return (
    <nav aria-label={t('viewLabel')} className="flex items-center gap-1">
      {link('mine')}
      {link('team')}
    </nav>
  );
}

/**
 * Converting (`/converting`, PRD TEL-03, docs/03-roadmap-appendix/phase1.md §9): the Lead Converter's board,
 * what to do next, and the open lead with its calls, sizing and quote on one screen. A team lead
 * (`calls.log` at team scope or wider) also has My team, and opens a person's leads from there
 * (`?owner=<id>&company=<id>`).
 */
export default async function ConvertingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, access, can } = await screenAccess(navRequires('converting'));
  const query = await searchParams;
  const t = await getTranslations('converting');
  const canTeam = can('calls.log', 'team');
  const team = canTeam && query.view === 'team';
  const ownerParam = typeof query.owner === 'string' ? query.owner : undefined;
  const ownerId =
    canTeam && ownerParam !== undefined && UUID.test(ownerParam) && ownerParam !== principal.id
      ? ownerParam
      : undefined;
  const entityId = ownerId === undefined ? undefined : companyParam(query.company);
  const actions = canTeam ? <ViewSwitch current={team ? 'team' : 'mine'} /> : undefined;

  if (team) {
    const rows = await listTeamQueues({});
    const names = companyNames(access);
    return (
      <Page title={t('title')} description={t('teamIntro')} actions={actions}>
        {rows.ok ? (
          rows.data.length === 0 ? (
            <p className="text-text-muted">{t('teamEmpty')}</p>
          ) : (
            <ul aria-label={t('teamCaption')} className="flex max-w-xl flex-col gap-2">
              {rows.data.map((row) => (
                <li
                  key={`${row.callerId}:${String(row.entityId)}`}
                  className="border-border bg-surface flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{row.callerName}</span>
                    <span className="text-text-muted text-sm">
                      {principal.entityIds.length > 1 ? `${names[row.entityId] ?? ''} · ` : ''}
                      {t('teamWaiting', { count: row.waiting })}
                    </span>
                  </span>
                  <Button asChild variant="secondary">
                    <Link
                      href={converterHref(row.callerId, row.entityId)}
                      aria-label={t('teamOpen', { name: row.callerName })}
                    >
                      {t('board.open')}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <FailureMessage failure={firstFailure(rows)} />
        )}
      </Page>
    );
  }

  const [board, members] = await Promise.all([
    loadConvertingBoard(boardInput({ ownerId, entityId })),
    ownerId === undefined ? undefined : listTeamQueues({}),
  ]);
  const ownerName =
    members?.ok === true ? members.data.find((m) => m.callerId === ownerId)?.callerName : undefined;
  return (
    <Page
      title={ownerName === undefined ? t('title') : t('viewing', { name: ownerName })}
      description={t('intro')}
      actions={
        ownerId === undefined ? (
          actions
        ) : (
          <Button asChild variant="secondary">
            <Link href="/converting?view=team">{t('backToTeam')}</Link>
          </Button>
        )
      }
    >
      {board.ok ? (
        <ConvertingScreen
          initialBoard={board.data}
          canWrite={can('crm.lead.write', 'own')}
          {...(ownerId === undefined ? {} : { ownerId })}
          {...(entityId === undefined ? {} : { entityId })}
        />
      ) : (
        <FailureMessage failure={firstFailure(board)} />
      )}
    </Page>
  );
}
