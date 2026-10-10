'use client';

import type {
  CallLeadDto,
  CallQueueItemDto,
  CallQueuePageDto,
  DispositionDto,
} from '@shakti/contracts';
import { Button, cn, EmptyState, StatusBadge, toast, type StatusTone } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dialNumber, listCallQueue, loadCallLead, logCall } from '../../actions/calling';
import {
  isTypingTarget,
  nextLead,
  outcomeForKey,
  outcomeNeeds,
  shortcutFor,
  type OutcomeNeed,
} from '../../screens/calling';
import { customerHref } from '../../screens/customers';
import { TimelineRow } from '../customers/timeline-row';
import { DateTime } from '../date-time';
import { FailureMessage } from '../screens/failure';
import { useCommand, useQuery } from '../screens/use-command';
import { DialNumber, Key, Outcomes, Panel, Search, savedMessage } from './calling-parts';
import type { OutcomeDetail } from './outcome-dialog';

// The detail dialog loads when an outcome first needs it.
const OutcomeDialog = dynamic(() => import('./outcome-dialog').then((m) => m.OutcomeDialog));

const REASON_TONE: Record<CallQueueItemDto['reason'], StatusTone> = {
  call_due: 'accent',
  nurture_due: 'info',
  first_call_late: 'warning',
  not_called: 'neutral',
  to_call: 'neutral',
};

/** The queue: the leads in order, the open one marked; the next page on request. */
function Queue({
  page,
  current,
  pending,
  onOpen,
  onMore,
  onRefresh,
  morePending,
}: {
  page: CallQueuePageDto;
  current: string | undefined;
  pending: boolean;
  onOpen: (item: CallQueueItemDto) => void;
  onMore: () => void;
  onRefresh: () => void;
  morePending: boolean;
}) {
  const t = useTranslations('calling');
  const common = useTranslations('common');
  return (
    <section
      aria-labelledby="calling-queue"
      className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="calling-queue" className="text-h3">
          {t('queue.title')}
        </h2>
        <Button size="sm" variant="ghost" pending={pending} onClick={onRefresh}>
          {t('queue.refresh')}
        </Button>
      </div>
      <p className="text-text-muted text-sm" aria-live="polite">
        {t('queue.count', { count: page.items.length })} · {t('queue.asOf')}{' '}
        <DateTime value={page.asOf} />
      </p>
      {page.items.length === 0 ? (
        <EmptyState message={t('queue.empty')} className="py-8" />
      ) : (
        <ol className="flex flex-col gap-1">
          {page.items.map((item) => {
            const selected = item.opportunityId === current;
            // --accent-soft carries --text at AA but not --text-muted in the dark theme, so the
            // selected row's secondary lines take the full text colour.
            const muted = selected ? 'text-text' : 'text-text-muted';
            return (
              <li key={item.opportunityId}>
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => {
                    onOpen(item);
                  }}
                  className={cn(
                    'hover:bg-surface-2 flex w-full min-w-0 flex-col gap-1 rounded-md border px-3 py-2 text-left',
                    selected ? 'border-accent bg-accent-soft' : 'border-transparent',
                  )}
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-medium">{item.customerName}</span>
                    <span className={cn(muted, 'shrink-0 text-xs tabular-nums')}>
                      {t('score', { score: item.score })}
                    </span>
                  </span>
                  <span className={cn(muted, 'truncate text-sm')}>
                    {[item.village, item.stageName].filter((v) => v !== null).join(' · ')}
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <StatusBadge tone={REASON_TONE[item.reason]}>
                      {t(`reason.${item.reason}`)}
                      {item.dueAt === null ? null : (
                        <>
                          {' '}
                          <DateTime value={item.dueAt} />
                        </>
                      )}
                    </StatusBadge>
                    {item.consentWithdrawn ? (
                      <StatusBadge tone="danger">{t('doNotCall')}</StatusBadge>
                    ) : null}
                    {item.attempts > 0 ? (
                      <span className={cn(muted, 'text-xs')}>
                        {t('tries', { count: item.attempts })}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {page.nextCursor === null ? null : (
        <Button variant="secondary" className="self-start" pending={morePending} onClick={onMore}>
          {common('loadMore')}
        </Button>
      )}
    </section>
  );
}

/** The script card: the lead's segment and the customer's call language (ADR 0014). */
function ScriptCard({ lead }: { lead: CallLeadDto }) {
  const t = useTranslations('calling');
  const segments = useTranslations('activity.values.segment');
  const languages = useTranslations('leads.language');
  return (
    <Panel id="calling-script" title={t('script.title')}>
      <p className="text-text-muted">
        {t('script.none', {
          segment: segments(lead.segment),
          language: languages(lead.language),
        })}
      </p>
    </Panel>
  );
}

/** What the lead's stage asks before it moves on. */
function Checklist({ lead }: { lead: CallLeadDto }) {
  const t = useTranslations('calling.checklist');
  const fields = useTranslations('pipelineSettings.stageField');
  return (
    <Panel id="calling-checklist" title={t('title')}>
      {lead.exitChecks.length === 0 ? (
        <p className="text-text-muted">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lead.exitChecks.map((check) => (
            <li key={check.field} className="flex items-center justify-between gap-2">
              <span>{fields(check.field)}</span>
              <StatusBadge tone={check.met ? 'success' : 'warning'}>
                {check.met ? t('met') : t('missing')}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The Cold Caller workspace (PRD TEL-01, docs/08-design-system.md §6 Caller workspace): the queue on one side and
 * the open lead on the other, worked from the keyboard: `N` the next lead, `1` to `9` the outcome
 * on that key, `D` the number to dial (shown only inside calling hours), `/` the search. Each
 * outcome saves the call through `calls.log`, which sets the next call or moves the lead; the
 * queue and the lead are then read again.
 */
export function CallingScreen({
  initialQueue,
  initialLead,
  callerId,
}: {
  initialQueue: CallQueuePageDto;
  initialLead: CallLeadDto | null;
  /** A team member whose queue a team lead is viewing; absent for the caller's own. */
  callerId?: string;
}) {
  const t = useTranslations('calling');
  const [queue, setQueue] = useState(initialQueue);
  const [lead, setLead] = useState<CallLeadDto | null>(initialLead);
  const [shown, setShown] = useState<string | undefined>();
  const [picked, setPicked] = useState<{ outcome: DispositionDto; need: OutcomeNeed }>();
  const searchRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLHeadingElement>(null);

  const leadQuery = useQuery<CallLeadDto>();
  const queueQuery = useQuery<CallQueuePageDto>();
  const moreQuery = useQuery<CallQueuePageDto>();
  const dial = useQuery<{ e164: string }>();
  // One form per lead: another lead's call is sent under a key of its own.
  const save = useCommand(logCall, lead?.opportunityId);

  const open = useCallback(
    (ref: { entityId: number; opportunityId: string }) => {
      setShown(undefined);
      // Only the lead's reference: the input is strict, and a queue row or a lead carries more.
      const input = { entityId: ref.entityId, opportunityId: ref.opportunityId };
      leadQuery.load(
        () => loadCallLead(input),
        (loaded) => {
          setLead(loaded);
          workspaceRef.current?.focus();
        },
      );
    },
    [leadQuery],
  );

  const refreshQueue = useCallback(() => {
    queueQuery.load(
      () => listCallQueue({ limit: 50, ...(callerId === undefined ? {} : { callerId }) }),
      setQueue,
    );
  }, [queueQuery, callerId]);

  const showNumber = useCallback(() => {
    if (lead === null) return;
    dial.load(
      () => dialNumber({ entityId: lead.entityId, opportunityId: lead.opportunityId }),
      (n) => {
        setShown(n.e164);
      },
    );
  }, [dial, lead]);

  const saveCall = useCallback(
    (outcome: DispositionDto, detail: OutcomeDetail | Record<string, never> = {}) => {
      if (lead === null) return;
      save.run(
        {
          entityId: lead.entityId,
          opportunityId: lead.opportunityId,
          dispositionId: outcome.id,
          ...detail,
        },
        (result) => {
          setPicked(undefined);
          toast.success(savedMessage(t, result));
          open(lead);
          refreshQueue();
        },
      );
    },
    [lead, save, t, open, refreshQueue],
  );

  const pick = useCallback(
    (outcome: DispositionDto) => {
      if (lead === null || !lead.canLog || lead.consentWithdrawn || save.pending) return;
      const need = outcomeNeeds(outcome.nextAction, lead.state);
      if (need === undefined) saveCall(outcome);
      else setPicked({ outcome, need });
    },
    [lead, save.pending, saveCall],
  );

  const goNext = useCallback(() => {
    const next = nextLead(queue.items, lead?.opportunityId);
    if (next !== undefined) open(next);
  }, [queue.items, lead, open]);

  // The workspace's keys, on the whole page while no field or dialog has the keyboard.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || picked !== undefined || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      const shortcut = shortcutFor(event);
      if (shortcut === undefined) return;
      event.preventDefault();
      if (shortcut.kind === 'next') goNext();
      else if (shortcut.kind === 'dial') showNumber();
      else if (shortcut.kind === 'search') {
        // The last search is selected, so the next name typed replaces it.
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (lead !== null) {
        const outcome = outcomeForKey(lead.dispositions, shortcut.key);
        if (outcome !== undefined) pick(outcome);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [picked, goNext, showNumber, pick, lead]);

  function loadMore() {
    const cursor = queue.nextCursor;
    if (cursor === null) return;
    moreQuery.load(
      () => listCallQueue({ limit: 50, cursor, ...(callerId === undefined ? {} : { callerId }) }),
      (page) => {
        setQueue((all) => ({ ...page, items: [...all.items, ...page.items] }));
      },
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section
          aria-label={t('search.label')}
          className="border-border bg-surface rounded-lg border p-4"
        >
          <Search
            inputRef={searchRef}
            onOpen={(hit) => {
              open({ entityId: hit.entityId, opportunityId: hit.id });
            }}
          />
        </section>
        <FailureMessage failure={queueQuery.failure ?? moreQuery.failure} />
        <Queue
          page={queue}
          current={lead?.opportunityId}
          pending={queueQuery.pending}
          morePending={moreQuery.pending}
          onOpen={open}
          onMore={loadMore}
          onRefresh={refreshQueue}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <FailureMessage failure={leadQuery.failure} />
        {lead === null ? (
          <EmptyState message={t('lead.empty')} />
        ) : (
          <>
            <section
              aria-labelledby="calling-lead"
              aria-busy={leadQuery.pending}
              className="border-border bg-surface flex min-w-0 flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <h2
                    id="calling-lead"
                    ref={workspaceRef}
                    tabIndex={-1}
                    className="text-h2 truncate outline-none"
                  >
                    {lead.customerName}
                  </h2>
                  <p className="text-text-muted text-sm">
                    {t('lead.stage', { pipeline: lead.pipelineName, stage: lead.stageName })}
                    {lead.village === null ? '' : ` · ${lead.village}`}
                    {lead.district === null ? '' : `, ${lead.district}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-text-muted text-sm tabular-nums">
                    {t('score', { score: lead.score })}
                  </span>
                  <Button size="sm" variant="ghost" onClick={goNext}>
                    {t('lead.nextLead')} <Key>{t('keys.next')}</Key>
                  </Button>
                  <Button size="sm" variant="link" asChild>
                    <Link href={customerHref(lead.accountId, lead.entityId)}>
                      {t('lead.openCustomer')}
                    </Link>
                  </Button>
                </div>
              </div>
              <DialNumber
                lead={lead}
                shown={shown}
                failure={dial.failure}
                pending={dial.pending}
                onShow={showNumber}
              />
              <p className="text-sm">
                {lead.nextCall === null ? (
                  t('lead.noNextCall')
                ) : (
                  <>
                    {lead.nextCall.kind === 'nurture'
                      ? t('lead.nextNurture')
                      : t('lead.nextCallback')}{' '}
                    <DateTime value={lead.nextCall.dueAt} />
                  </>
                )}
              </p>
              {lead.attempts > 0 ? (
                <p className="text-text-muted text-sm">
                  {t('lead.tries', { count: lead.attempts, max: lead.maxAttempts })}
                </p>
              ) : null}
            </section>
            <Outcomes lead={lead} pending={save.pending} onPick={pick} />
            <FailureMessage failure={picked === undefined ? save.failure : undefined} />
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
              <ScriptCard lead={lead} />
              <Checklist lead={lead} />
            </div>
            <Panel id="calling-activity" title={t('activity.title')}>
              {lead.recentActivity.length === 0 ? (
                <p className="text-text-muted">{t('activity.empty')}</p>
              ) : (
                <ol className="flex flex-col gap-3">
                  {lead.recentActivity.map((item) => (
                    <TimelineRow key={item.id} item={item} />
                  ))}
                </ol>
              )}
            </Panel>
          </>
        )}
      </div>
      {picked === undefined || lead === null ? null : (
        <OutcomeDialog
          outcome={picked.outcome}
          need={picked.need}
          pending={save.pending}
          failure={save.failure}
          onSave={(detail) => {
            saveCall(picked.outcome, detail);
          }}
          onCancel={() => {
            setPicked(undefined);
          }}
        />
      )}
    </div>
  );
}
