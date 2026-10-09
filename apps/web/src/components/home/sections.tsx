import type {
  CallerHomeDto,
  CreditHomeDto,
  MyProgressDto,
  PipelineStagesDto,
  ResponseTimeDto,
  SalesHomeDto,
  TargetMetric,
  TargetPeriod,
  TeamProgressDto,
  TeamQueueDto,
} from '@shakti/contracts';
import { Button, EmptyState } from '@shakti/ui';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { TeamQueues } from '../calling/team-queues';
import { formatCount, formatDate, formatRupees } from '../../screens/format';
import { meterPercent, metricNumber, targetMet } from '../../screens/home';
import { TARGET_METRICS, TARGET_PERIODS } from '../../screens/contract-values';
import { HomeBlock, hasTargets, PeriodProgress, ProgressMeter, Stat } from './progress';

/** A company's name above its figures, only where the page shows more than one company. */
function Company({ show, name }: { show: boolean; name: string | undefined }) {
  if (!show || name === undefined) return null;
  return <h3 className="font-semibold">{name}</h3>;
}

/** The queue and targets of a Cold Caller or Lead Converter. */
export async function CallerSection({
  queue,
  progress,
  companies,
}: {
  queue: readonly CallerHomeDto[];
  progress: readonly MyProgressDto[];
  companies: Record<number, string>;
}) {
  const t = await getTranslations('home.caller');
  const showCompany = queue.length > 1;
  return (
    <>
      <HomeBlock
        id="home-caller-queue"
        title={t('queueHeading')}
        actions={
          <Button asChild variant="secondary">
            <Link href="/calling">{t('openQueue')}</Link>
          </Button>
        }
      >
        {queue.map((q) => (
          <div key={q.entityId} className="flex flex-col gap-2">
            <Company show={showCompany} name={companies[q.entityId]} />
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t('callsToday')} value={formatCount(q.callsToday)} />
              <Stat label={t('due')} value={formatCount(q.due)} />
              <Stat label={t('late')} value={formatCount(q.late)} />
              <Stat label={t('waiting')} value={formatCount(q.waiting)} />
            </dl>
          </div>
        ))}
      </HomeBlock>
      <HomeBlock id="home-caller-targets" title={t('targetsHeading')}>
        {progress.map((p) => (
          <div key={p.entityId} className="flex flex-col gap-2">
            <Company show={progress.length > 1} name={companies[p.entityId]} />
            <PeriodProgress periods={p.periods} empty={t('targetsEmpty')} />
          </div>
        ))}
      </HomeBlock>
    </>
  );
}

/** The address of the home page on one period of the team view. */
function periodHref(period: TargetPeriod, metric: TargetMetric) {
  return `/home?period=${period}&metric=${metric}` as const;
}

/** A team lead's team: progress against the team's targets, the leaderboard and the queues. */
export async function LeadSection({
  teams,
  queues,
  period,
  metric,
  companies,
}: {
  teams: readonly TeamProgressDto[];
  queues: readonly TeamQueueDto[];
  period: TargetPeriod;
  metric: TargetMetric;
  companies: Record<number, string>;
}) {
  const t = await getTranslations('home.lead');
  const p = await getTranslations('home.progress');
  const showCompany = teams.length > 1;
  return (
    <>
      <HomeBlock
        id="home-lead-team"
        title={t('teamHeading')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label={t('periodLabel')} className="flex items-center gap-1">
              {TARGET_PERIODS.map((value) => (
                <Button key={value} asChild variant={value === period ? 'secondary' : 'ghost'}>
                  <Link
                    href={periodHref(value, metric)}
                    aria-current={value === period ? 'page' : undefined}
                  >
                    {p(`period.${value}`)}
                  </Link>
                </Button>
              ))}
            </nav>
            <Button asChild variant="secondary">
              <Link href="/targets">{t('setTargets')}</Link>
            </Button>
          </div>
        }
      >
        {teams.length === 0 ? <EmptyState message={t('noTeam')} /> : null}
        {teams.map((team) => (
          <div key={team.teamId} className="flex flex-col gap-3">
            <Company show={showCompany} name={companies[team.entityId]} />
            <div className="bg-surface border-border flex flex-col gap-3 rounded-lg border p-4">
              <h3 className="font-semibold">{t('teamTargets', { team: team.teamName })}</h3>
              {hasTargets(team.team) ? (
                <ul className="flex flex-col gap-3">
                  {team.team.map((progress) => (
                    <ProgressMeter key={progress.metric} progress={progress} />
                  ))}
                </ul>
              ) : (
                <p className="text-text-muted">{t('teamNoTarget')}</p>
              )}
              <span className="text-text-muted text-sm">
                {team.period === 'day'
                  ? p('period.day')
                  : p('range', { from: formatDate(team.startsOn), to: formatDate(team.endsOn) })}
              </span>
            </div>
            <Leaderboard team={team} />
          </div>
        ))}
      </HomeBlock>
      <HomeBlock id="home-lead-queues" title={t('queuesHeading')}>
        <TeamQueues rows={queues} companies={companies} showCompany={showCompany} />
      </HomeBlock>
    </>
  );
}

/** The callers of a team ranked by one metric, with every metric against the caller's target. */
async function Leaderboard({ team }: { team: TeamProgressDto }) {
  const t = await getTranslations('home.lead');
  const m = await getTranslations('targets.metric');
  const p = await getTranslations('home.progress');
  if (team.leaderboard.length === 0) return <EmptyState message={t('noCallers')} />;
  const number = 'px-3 py-2 text-right tabular-nums';
  return (
    <div className="border-border bg-surface overflow-x-auto rounded-lg border">
      <table className="w-full min-w-xl text-sm">
        <caption className="sr-only">
          {t('leaderboardCaption', { metric: m(team.metric), period: p(`period.${team.period}`) })}
        </caption>
        <thead className="bg-surface-2 text-text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t('rank')}
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {t('caller')}
            </th>
            {TARGET_METRICS.map((metric) => (
              <th key={metric} scope="col" className={`${number} font-medium`}>
                <Link
                  href={periodHref(team.period, metric)}
                  className="hover:underline"
                  aria-current={metric === team.metric ? 'true' : undefined}
                >
                  {m(metric)}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {team.leaderboard.map((row, index) => (
            <tr key={row.callerId} className="border-border border-t">
              <td className="px-3 py-2 tabular-nums">{index + 1}</td>
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {row.callerName}
              </th>
              {row.metrics.map((cell) => (
                <td key={cell.metric} className={number}>
                  <span className={targetMet(cell.fraction) ? 'text-success font-medium' : ''}>
                    {metricNumber(cell.metric, cell.actual)}
                  </span>
                  {cell.target === null ? null : (
                    <span className="text-text-muted">
                      {' '}
                      {p('ofShort', {
                        target: metricNumber(cell.metric, cell.target),
                        percent: meterPercent(cell.fraction),
                      })}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Open leads by stage, one block per pipeline. */
export async function PipelineBlocks({
  pipelines,
  companies,
  showCompany,
}: {
  pipelines: readonly PipelineStagesDto[];
  companies: Record<number, string>;
  showCompany: boolean;
}) {
  const t = await getTranslations('home.pipeline');
  if (pipelines.length === 0) return <EmptyState message={t('empty')} />;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {pipelines.map((pipeline) => (
        <div
          key={`${String(pipeline.entityId)}-${pipeline.pipelineId}`}
          className="bg-surface border-border flex flex-col gap-3 rounded-lg border p-4"
        >
          <h3 className="font-semibold">
            {showCompany
              ? t('pipelineIn', {
                  pipeline: pipeline.pipelineName,
                  company: companies[pipeline.entityId] ?? '',
                })
              : pipeline.pipelineName}
          </h3>
          <table className="w-full text-sm">
            <caption className="sr-only">{t('caption', { pipeline: pipeline.pipelineName })}</caption>
            <thead className="text-text-muted">
              <tr>
                <th scope="col" className="py-1 text-left font-medium">
                  {t('stage')}
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  {t('leads')}
                </th>
              </tr>
            </thead>
            <tbody>
              {pipeline.stages.map((stage) => (
                <tr key={stage.stageId} className="border-border border-t">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {stage.stageName}
                  </th>
                  <td className="py-1.5 text-right tabular-nums">{formatCount(stage.leads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** The General Manager's overview: first calls past their limit, then the pipeline by stage. */
export async function ManagerSection({
  response,
  pipelines,
  companies,
}: {
  response: readonly ResponseTimeDto[];
  pipelines: readonly PipelineStagesDto[];
  companies: Record<number, string>;
}) {
  const t = await getTranslations('home.manager');
  const showCompany = response.length > 1;
  return (
    <>
      <HomeBlock id="home-manager-response" title={t('responseHeading')}>
        {response.map((r) => (
          <div key={r.entityId} className="flex flex-col gap-2">
            <Company show={showCompany} name={companies[r.entityId]} />
            {r.limitSet ? (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Stat label={t('waitingPastLimit')} value={formatCount(r.waitingPastLimit)} />
                <Stat label={t('calledLate')} value={formatCount(r.calledLate)} />
              </dl>
            ) : (
              <p className="text-text-muted">{t('noLimit')}</p>
            )}
          </div>
        ))}
      </HomeBlock>
      <HomeBlock id="home-manager-pipeline" title={t('pipelineHeading')}>
        <PipelineBlocks pipelines={pipelines} companies={companies} showCompany={showCompany} />
      </HomeBlock>
    </>
  );
}

/** Accounts: dealer credit at a glance, with a way to the dealers. */
export async function AccountsSection({
  credit,
  companies,
}: {
  credit: readonly CreditHomeDto[];
  companies: Record<number, string>;
}) {
  const t = await getTranslations('home.accounts');
  return (
    <HomeBlock
      id="home-accounts-credit"
      title={t('heading')}
      actions={
        <Button asChild variant="secondary">
          <Link href="/dealer-credit">{t('open')}</Link>
        </Button>
      }
    >
      {credit.map((c) => (
        <div key={c.entityId} className="flex flex-col gap-2">
          <Company show={credit.length > 1} name={companies[c.entityId]} />
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label={t('held')} value={formatCount(c.heldOrders)} />
            <Stat label={t('overLimit')} value={formatCount(c.dealersOverLimit)} />
            <Stat label={t('overdue')} value={formatCount(c.overdueInvoices)} />
          </dl>
        </div>
      ))}
    </HomeBlock>
  );
}

/** Sums money strings in paise, so the group total is exact. */
function sumMoney(values: readonly string[]): string {
  const paise = values.reduce((sum, v) => sum + BigInt(v.replace('.', '')), 0n);
  const text = paise.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

/** The Executive's overview: the pipeline by stage, then quotes and orders per company and in all. */
export async function ExecutiveSection({
  sales,
  pipelines,
  companies,
}: {
  sales: readonly SalesHomeDto[];
  pipelines: readonly PipelineStagesDto[];
  companies: Record<number, string>;
}) {
  const t = await getTranslations('home.executive');
  const number = 'px-3 py-2 text-right tabular-nums';
  const total = {
    quotesSent: sales.reduce((n, s) => n + s.quotesSent, 0),
    quotesAccepted: sales.reduce((n, s) => n + s.quotesAccepted, 0),
    ordersConfirmed: sales.reduce((n, s) => n + s.ordersConfirmed, 0),
    ordersValue: sumMoney(sales.map((s) => s.ordersValue)),
  };
  return (
    <>
      <HomeBlock id="home-executive-sales" title={t('salesHeading')}>
        <div className="border-border bg-surface overflow-x-auto rounded-lg border">
          <table className="w-full min-w-xl text-sm">
            <caption className="sr-only">{t('caption')}</caption>
            <thead className="bg-surface-2 text-text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  {t('company')}
                </th>
                <th scope="col" className={`${number} font-medium`}>
                  {t('quotesSent')}
                </th>
                <th scope="col" className={`${number} font-medium`}>
                  {t('quotesAccepted')}
                </th>
                <th scope="col" className={`${number} font-medium`}>
                  {t('ordersConfirmed')}
                </th>
                <th scope="col" className={`${number} font-medium`}>
                  {t('ordersValue')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.entityId} className="border-border border-t">
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {companies[s.entityId] ?? ''}
                  </th>
                  <td className={number}>{formatCount(s.quotesSent)}</td>
                  <td className={number}>{formatCount(s.quotesAccepted)}</td>
                  <td className={number}>{formatCount(s.ordersConfirmed)}</td>
                  <td className={number}>{formatRupees(s.ordersValue)}</td>
                </tr>
              ))}
            </tbody>
            {sales.length > 1 ? (
              <tfoot>
                <tr className="border-border bg-surface-2 border-t font-medium">
                  <th scope="row" className="px-3 py-2 text-left">
                    {t('group')}
                  </th>
                  <td className={number}>{formatCount(total.quotesSent)}</td>
                  <td className={number}>{formatCount(total.quotesAccepted)}</td>
                  <td className={number}>{formatCount(total.ordersConfirmed)}</td>
                  <td className={number}>{formatRupees(total.ordersValue)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </HomeBlock>
      <HomeBlock id="home-executive-pipeline" title={t('pipelineHeading')}>
        <PipelineBlocks
          pipelines={pipelines}
          companies={companies}
          showCompany={sales.length > 1}
        />
      </HomeBlock>
    </>
  );
}
