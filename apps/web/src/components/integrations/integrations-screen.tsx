'use client';

import type {
  AgentSpend,
  DeadLetteredEvent,
  DeliveryCheck,
  IntegrationHealthResponse,
  OutboxTypeHealth,
} from '@shakti/contracts';
import { Button, DataGrid, EmptyState, StatusBadge, toast, type DataGridColumn } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { integrationHealth, deliveryCheck, runDeliveryCheck } from '../../actions/integrations';
import { replayDeadLetter } from '../../actions/admin';
import { eventNameKey } from '../../screens/audit';
import { formatCount, formatDateTime, formatRupees } from '../../screens/format';
import { CHECK_POLL_MS, CHECK_POLL_TRIES, heldReason } from '../../screens/integrations';
import { DateTime } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { settle } from '../screens/settle';
import { useCommand, useQuery } from '../screens/use-command';

const PAGE_SIZE = 50;

/** An update's name on screen, from the Activity log's names for the kinds of update. */
function useUpdateName() {
  const activity = useTranslations('activity');
  const t = useTranslations('integrations');
  return (type: string) => {
    const key = eventNameKey(type);
    return key === undefined ? t('otherUpdate') : activity(`events.${key}`);
  };
}

/**
 * Admin › Integration health: the updates waiting by kind, the last sending round, the delivery
 * check and the held-back updates with Send again.
 */
export function IntegrationsScreen({
  initial,
  companies,
}: {
  initial: IntegrationHealthResponse;
  companies: Record<number, string>;
}) {
  const t = useTranslations('integrations');
  const updateName = useUpdateName();
  const run = initial.outbox.lastPublisherRun;

  const waitingColumns: DataGridColumn<OutboxTypeHealth>[] = [
    { id: 'update', header: t('columns.update'), cell: (r) => updateName(r.type), primary: true },
    {
      id: 'waiting',
      header: t('columns.waiting'),
      cell: (r) => formatCount(r.pending),
      numeric: true,
    },
    { id: 'ready', header: t('columns.ready'), cell: (r) => formatCount(r.due), numeric: true },
    {
      id: 'held',
      header: t('columns.held'),
      cell: (r) => formatCount(r.deadLettered),
      numeric: true,
    },
    {
      id: 'since',
      header: t('columns.since'),
      cell: (r) => (r.oldestPendingAt === null ? '' : <DateTime value={r.oldestPendingAt} />),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="integrations-waiting" className="flex flex-col gap-3">
        <h2 id="integrations-waiting" className="text-h3">
          {t('waiting.heading')}
        </h2>
        <DataGrid
          caption={t('waiting.caption')}
          columns={waitingColumns}
          rows={initial.outbox.byType}
          rowKey={(r) => r.type}
          empty={<EmptyState message={t('waiting.empty')} />}
        />
        {/* data-dynamic: the last round changes from minute to minute, so screenshots mask it. */}
        <p data-dynamic className="text-text-muted">
          <span className="font-medium text-text">{t('lastRun.heading')}: </span>
          {run === null
            ? t('lastRun.none')
            : t('lastRun.summary', {
                at: formatDateTime(run.at),
                sent: formatCount(run.published + run.skipped),
                failed: formatCount(run.failed),
                held: formatCount(run.deadLettered),
              })}
        </p>
      </section>
      <DeliverySpeed initial={initial.deliveryCheck} />
      <HeldUpdates initial={initial.deadLetters} companies={companies} />
      <AiSpend spend={initial.aiSpend} companies={companies} />
    </div>
  );
}

/** The delivery check: one update sent through the system and timed, asked again until it lands. */
function DeliverySpeed({ initial }: { initial: DeliveryCheck | null }) {
  const t = useTranslations('integrations');
  const [check, setCheck] = useState(initial);
  const { run, pending, failure } = useCommand(runDeliveryCheck);
  const tries = useRef(0);

  useEffect(() => {
    if (check?.state !== 'waiting' || tries.current >= CHECK_POLL_TRIES) return;
    const timer = setTimeout(() => {
      tries.current += 1;
      void settle(() =>
        deliveryCheck({ probeId: check.probeId, requestedAt: check.requestedAt }),
      ).then((result) => {
        if (result.ok) setCheck(result.data);
      });
    }, CHECK_POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [check]);

  return (
    <section aria-labelledby="integrations-delivery" className="flex flex-col gap-3">
      <h2 id="integrations-delivery" className="text-h3">
        {t('delivery.heading')}
      </h2>
      <p className="text-text-muted">{t('delivery.intro')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            run({}, (started) => {
              tries.current = 0;
              setCheck(started);
            });
          }}
        >
          {t('delivery.check')}
        </Button>
        {/* data-dynamic: each check's time and speed differ, so screenshots mask it. */}
        <p role="status" data-dynamic className="text-text">
          {check === null
            ? t('delivery.none')
            : check.state === 'arrived'
              ? t('delivery.arrived', {
                  milliseconds: check.milliseconds ?? 0,
                  at: formatDateTime(check.requestedAt),
                })
              : t(`delivery.${check.state}`, { at: formatDateTime(check.requestedAt) })}
        </p>
      </div>
      <FailureMessage failure={failure} />
    </section>
  );
}

/** The held-back updates, newest first, with Send again and Show more. */
function HeldUpdates({
  initial,
  companies,
}: {
  initial: IntegrationHealthResponse['deadLetters'];
  companies: Record<number, string>;
}) {
  const t = useTranslations('integrations');
  const common = useTranslations('common');
  const updateName = useUpdateName();
  const [rows, setRows] = useState(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const more = useQuery<IntegrationHealthResponse>();
  const replay = useCommand(replayDeadLetter);

  const columns: DataGridColumn<DeadLetteredEvent>[] = [
    { id: 'update', header: t('columns.update'), cell: (r) => updateName(r.type), primary: true },
    {
      id: 'company',
      header: t('columns.company'),
      cell: (r) => companies[r.entityId] ?? common('notSet'),
    },
    {
      id: 'tries',
      header: t('columns.tries'),
      cell: (r) => formatCount(r.attempts),
      numeric: true,
    },
    {
      id: 'reason',
      header: t('columns.reason'),
      cell: (r) => (
        <StatusBadge tone="danger">{t(`reasons.${heldReason(r.errorCode)}`)}</StatusBadge>
      ),
    },
    {
      id: 'heldAt',
      header: t('columns.heldAt'),
      cell: (r) => <DateTime value={r.deadLetteredAt} />,
    },
    {
      id: 'actions',
      header: t('columns.actions'),
      align: 'end',
      // The button keeps its visible words as its name; which update it sends is read out after.
      cell: (r) => (
        <>
          <span id={`held-${r.eventId}`} className="sr-only">
            {t('held.describe', {
              update: updateName(r.type),
              at: formatDateTime(r.deadLetteredAt),
            })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={replay.pending}
            aria-describedby={`held-${r.eventId}`}
            onClick={() => {
              replay.run({ eventId: r.eventId }, () => {
                setRows((all) => all.filter((row) => row.eventId !== r.eventId));
                setTotal((n) => Math.max(0, n - 1));
                toast.success(t('held.sent'));
              });
            }}
          >
            {t('held.sendAgain')}
          </Button>
        </>
      ),
    },
  ];

  return (
    <section aria-labelledby="integrations-held" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="integrations-held" className="text-h3">
          {t('held.heading')}
        </h2>
        <span className="text-text-muted">{t('held.total', { count: total })}</span>
      </div>
      <p className="text-text-muted">{t('held.intro')}</p>
      <DataGrid
        caption={t('held.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.eventId}
        empty={<EmptyState message={t('held.empty')} />}
        loadMore={
          cursor === null
            ? undefined
            : {
                label: t('held.loadMore'),
                pending: more.pending,
                onLoadMore: () => {
                  more.load(
                    () => integrationHealth({ cursor, limit: PAGE_SIZE }),
                    (page) => {
                      setRows((all) => [...all, ...page.deadLetters.items]);
                      setTotal(page.deadLetters.total);
                      setCursor(page.deadLetters.nextCursor);
                    },
                  );
                },
              }
        }
      />
      <FailureMessage failure={replay.failure ?? more.failure} />
    </section>
  );
}

/**
 * AI spend per agent and company (A1): today's and this month's spend and runs, from the agents'
 * own runs, beside the daily limits that apply there. Spend changes with every run, so screenshots
 * mask the figures.
 */
function AiSpend({
  spend,
  companies,
}: {
  spend: IntegrationHealthResponse['aiSpend'];
  companies: Record<number, string>;
}) {
  const t = useTranslations('integrations');
  const agents = useTranslations('agents');
  const limit = (r: AgentSpend) => {
    if (r.dailyCap !== null && r.groupDailyCap !== null) {
      return t('aiSpend.bothLimits', {
        company: formatRupees(r.dailyCap),
        group: formatRupees(r.groupDailyCap),
      });
    }
    if (r.dailyCap !== null) return formatRupees(r.dailyCap);
    if (r.groupDailyCap !== null) {
      return t('aiSpend.groupLimit', { amount: formatRupees(r.groupDailyCap) });
    }
    return t('aiSpend.noLimit');
  };
  const columns: DataGridColumn<AgentSpend>[] = [
    {
      id: 'agent',
      header: t('columns.agent'),
      cell: (r) => agents(`names.${r.agent}`),
      primary: true,
    },
    {
      id: 'company',
      header: t('columns.company'),
      cell: (r) => companies[r.entityId] ?? t('aiSpend.otherCompany'),
    },
    {
      id: 'today',
      header: t('columns.spentToday'),
      numeric: true,
      cell: (r) => <span data-dynamic>{formatRupees(r.today)}</span>,
    },
    {
      id: 'runsToday',
      header: t('columns.runsToday'),
      numeric: true,
      cell: (r) => <span data-dynamic>{formatCount(r.runsToday)}</span>,
    },
    {
      id: 'month',
      header: t('columns.spentMonth'),
      numeric: true,
      cell: (r) => <span data-dynamic>{formatRupees(r.monthToDate)}</span>,
    },
    {
      id: 'runsMonth',
      header: t('columns.runsMonth'),
      numeric: true,
      cell: (r) => <span data-dynamic>{formatCount(r.runsMonthToDate)}</span>,
    },
    { id: 'limit', header: t('columns.dailyLimit'), cell: limit },
    {
      id: 'stopped',
      header: t('columns.limitReached'),
      cell: (r) =>
        r.stoppedByCap ? (
          <StatusBadge tone="warning">{t('aiSpend.reached')}</StatusBadge>
        ) : (
          <span className="text-text-muted">{t('aiSpend.notReached')}</span>
        ),
    },
  ];
  return (
    <section aria-labelledby="integrations-ai" className="flex flex-col gap-3">
      <h2 id="integrations-ai" className="text-h3">
        {t('aiSpend.heading')}
      </h2>
      <p data-dynamic className="text-text-muted">
        {t('aiSpend.total', {
          today: formatRupees(spend.today),
          month: formatRupees(spend.monthToDate),
        })}
      </p>
      <DataGrid
        caption={t('aiSpend.caption')}
        columns={columns}
        rows={spend.byAgent}
        rowKey={(r) => `${r.agent}-${String(r.entityId)}`}
        empty={<EmptyState message={t('aiSpend.empty')} />}
      />
    </section>
  );
}
