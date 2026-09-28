import { Button, EmptyState } from '@shakti/ui';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { leadFormOptions, listBoardLeads } from '../../../../actions/crm';
import { LeadBoardScreen } from '../../../../components/leads/lead-board-screen';
import { LeadsViewSwitch } from '../../../../components/leads/view-switch';
import { FailureMessage } from '../../../../components/screens/failure';
import { Page } from '../../../../components/shell/page';
import { companyNames, screenAccess } from '../../../../screens/access';
import { navRequires } from '../../../../nav';
import { boardChoice, statesFor } from '../../../../screens/lead-board';
import { firstFailure } from '../../../../screens/result';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('leads'))('title') };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Leads › Board (DESIGN.md §6): the leads of one company and one line of business by stage. The
 * address carries the company, pipeline and status filter, so a board can be bookmarked.
 */
export default async function LeadsBoardPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal, access, can } = await screenAccess(navRequires('leads'));
  const t = await getTranslations('leads');
  const params = await searchParams;
  const canAdd = can('crm.lead.write', 'own') && can('crm.account.write', 'own');
  const actions = (
    <>
      <LeadsViewSwitch current="board" />
      {canAdd ? (
        <Button asChild>
          <Link href="/leads/new">{t('add')}</Link>
        </Button>
      ) : null}
    </>
  );

  const options = await leadFormOptions();
  if (!options.ok) {
    return (
      <Page title={t('title')} description={t('board.intro')} actions={actions}>
        <FailureMessage failure={firstFailure(options)} />
      </Page>
    );
  }
  const choice = boardChoice({
    pipelines: options.data.pipelines,
    entityIds: principal.entityIds,
    company: one(params.company),
    pipeline: one(params.pipeline),
    show: one(params.show),
  });
  const pipeline = choice.pipeline;
  const names = companyNames(access);
  const board =
    pipeline === undefined
      ? undefined
      : await listBoardLeads({
          ...(choice.entityId === undefined ? {} : { entityId: choice.entityId }),
          pipelineKey: pipeline.key,
          states: statesFor(choice.show),
        });

  return (
    <Page title={t('title')} description={t('board.intro')} actions={actions}>
      {pipeline === undefined || board === undefined ? (
        <EmptyState message={t('board.noPipelines')} />
      ) : board.ok ? (
        <LeadBoardScreen
          // A new company, pipeline or filter is a new board: its state starts afresh.
          key={`${String(choice.entityId)}:${pipeline.key}:${choice.show}`}
          initial={board.data}
          stages={pipeline.stages}
          pipelines={choice.pipelines.map((p) => ({ key: p.key, name: p.name }))}
          pipelineKey={pipeline.key}
          companies={principal.entityIds.map((id) => ({ id, name: names[id] ?? '' }))}
          entityId={choice.entityId}
          show={choice.show}
          can={{
            write: can('crm.lead.write', 'own'),
            assign: can('crm.lead.assign', 'own'),
          }}
        />
      ) : (
        <FailureMessage failure={firstFailure(board)} />
      )}
    </Page>
  );
}
