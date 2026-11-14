'use client';

import type {
  CallLeadDto,
  DialOutcomeDto,
  DialReadinessDto,
  ProviderCallDto,
} from '@shakti/contracts';
import { Button, StatusBadge, type StatusTone } from '@shakti/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { dialCall, dialReadiness, providerCallStatus } from '../../actions/dialling';
import { isTypingTarget } from '../../screens/calling';
import { FailureMessage } from '../screens/failure';
import { useQuery } from '../screens/use-command';
import { Key } from './calling-parts';

/** What the workspace keeps of a call placed from the screen, for the call's log. */
export interface DialledCall {
  opportunityId: string;
  providerCallId: string;
  /** When Dial was pressed: the call's start, as the provider call keeps it. */
  startedAt: string;
  /** Seconds on the line: the provider's once it reported them, else the bar's own count. */
  durationSeconds: number | undefined;
  ended: boolean;
}

type Refusals = Extract<DialOutcomeDto, { kind: 'refused' }>['refusals'];

/** How often the bar reads the call again while the provider reports it. */
const POLL_MS = 2_000;
/**
 * The bar stops reading a call this long after it was pressed, whatever its status: by then the
 * hourly sweep has closed a call whose end was never reported (`OPEN_CALL_HOURS`).
 */
const POLL_LIMIT_MS = 3 * 3_600_000;

const ENDS: ReadonlySet<ProviderCallDto['status']> = new Set([
  'completed',
  'no_answer',
  'busy',
  'failed',
  'canceled',
]);

const TONE: Record<ProviderCallDto['status'], StatusTone> = {
  dialling: 'info',
  ringing: 'info',
  in_progress: 'success',
  completed: 'neutral',
  no_answer: 'warning',
  busy: 'warning',
  failed: 'danger',
  canceled: 'warning',
};

/** `m:ss` of a count of seconds. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds the call has run, as the bar shows them: on the line since the answer, else since the press. */
export function elapsedSeconds(call: ProviderCallDto, now: number): number {
  if (call.durationS !== null && ENDS.has(call.status)) return call.durationS;
  const from = call.answeredAt ?? call.startedAt;
  const until = call.endedAt === null ? now : Date.parse(call.endedAt);
  return Math.max(0, Math.round((until - Date.parse(from)) / 1000));
}

/**
 * The call bar (docs/03-roadmap-appendix/phase2.md §6.3, PRD TEL-01): Call from screen, with `C`
 * where the workspace gives the key, which has the provider ring the caller's own phone and then
 * the customer's from the company's number; then the call as the provider reports it (ringing, on
 * the line, ended) with its time. It is offered only where the runtime has a provider and the
 * lead's company has a calling number, and asks the caller to add their own phone first; the
 * manual flow beside it stays for every other case. A refused dial lists every rule it broke.
 * `onCall` hands the call to the workspace, whose log of it takes the provider call's start and
 * length; once that log is saved the workspace mounts the bar afresh (a new `key`), so the next
 * call on the lead starts from Call again.
 */
export function CallBar({
  lead,
  dialKey = false,
  onCall,
}: {
  lead: CallLeadDto;
  /** Whether `C` dials (the Cold Caller workspace; Converting keeps `C` for a callback). */
  dialKey?: boolean;
  onCall: (call: DialledCall | undefined) => void;
}) {
  const t = useTranslations('calling.bar');
  const refusalT = useTranslations('calling.plan.refusal');
  const keys = useTranslations('calling.keys');
  const ready = useQuery<DialReadinessDto>();
  const dial = useQuery<DialOutcomeDto>();
  const [readiness, setReadiness] = useState<{ entityId: number; dto: DialReadinessDto }>();
  const [call, setCall] = useState<ProviderCallDto>();
  const [refusals, setRefusals] = useState<{ lead: string; reasons: Refusals }>();
  const [now, setNow] = useState(() => Date.now());

  const { entityId, opportunityId } = lead;
  useEffect(() => {
    if (readiness?.entityId === entityId) return;
    ready.load(
      () => dialReadiness({ entityId }),
      (dto) => {
        setReadiness({ entityId, dto });
      },
    );
  }, [entityId, readiness?.entityId, ready]);

  // Another lead opened: its bar starts empty, since the call and the refusals shown are only
  // ever the open lead's, and the workspace keeps a call only for the lead it was placed on.
  const shown = call?.opportunityId === opportunityId ? call : undefined;
  const live = shown !== undefined && !ENDS.has(shown.status);

  // The provider's reports reach the call on the server; the bar reads it again while it runs.
  useEffect(() => {
    if (shown === undefined || !live) return;
    if (Date.now() - Date.parse(shown.startedAt) > POLL_LIMIT_MS) return;
    const timer = setTimeout(() => {
      void providerCallStatus({ entityId: shown.entityId, providerCallId: shown.id }).then(
        (result) => {
          if (result.ok) setCall(result.data);
        },
      );
    }, POLL_MS);
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [shown, live]);

  useEffect(() => {
    if (shown === undefined) return;
    const ended = ENDS.has(shown.status);
    onCall({
      opportunityId: shown.opportunityId,
      providerCallId: shown.id,
      startedAt: shown.startedAt,
      durationSeconds: shown.durationS ?? (ended ? elapsedSeconds(shown, Date.now()) : undefined),
      ended,
    });
  }, [shown, onCall]);

  const ok = readiness?.entityId === entityId ? readiness.dto : undefined;
  const offered =
    ok !== undefined && ok.available && lead.phoneLast4 !== null && !lead.consentWithdrawn;

  const press = useCallback(() => {
    if (!offered || !ok.dialPhoneSet || live || dial.pending) return;
    setRefusals(undefined);
    dial.load(
      () => dialCall({ entityId, opportunityId }),
      (outcome) => {
        if (outcome.kind === 'placed') {
          setNow(Date.now());
          setCall(outcome.call);
        } else {
          setRefusals({ lead: opportunityId, reasons: outcome.refusals });
        }
      },
    );
  }, [offered, ok, live, dial, entityId, opportunityId]);

  useEffect(() => {
    if (!dialKey) return;
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'c' && event.key !== 'C') return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      event.preventDefault();
      press();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [dialKey, press]);

  if (!offered) return null;
  const refused: Refusals | [] = refusals?.lead === opportunityId ? refusals.reasons : [];

  return (
    <section
      aria-labelledby={`call-bar-${opportunityId}`}
      className="border-border flex min-w-0 flex-col gap-2 border-t pt-3"
      data-testid="call-bar"
    >
      <h3 id={`call-bar-${opportunityId}`} className="font-semibold">
        {t('title')}
      </h3>
      <p className="text-sm">
        <span className="font-medium">{t('noticeFirst')}</span>{' '}
        <q lang={lead.language === 'en' ? 'en' : 'hi-Latn'}>
          {lead.language === 'en' ? ok.notice.en : ok.notice.hinglish}
        </q>
      </p>
      {ok.dialPhoneSet ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" pending={dial.pending} disabled={live} onClick={press}>
            {t('dial')}
            {dialKey ? <Key>{keys('callFromScreen')}</Key> : null}
          </Button>
          {shown === undefined ? (
            <span className="text-text-muted text-sm">{t('howItWorks')}</span>
          ) : (
            <span className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
              <StatusBadge tone={TONE[shown.status]}>{t(`status.${shown.status}`)}</StatusBadge>
              <span className="tabular-nums" aria-label={t('timeLabel')}>
                {clock(elapsedSeconds(shown, now))}
              </span>
            </span>
          )}
        </div>
      ) : (
        <p className="text-sm">
          {t('noOwnPhone')}{' '}
          <Link href="/settings/profile#dial-phone" className="text-accent-text underline">
            {t('addOwnPhone')}
          </Link>
        </p>
      )}
      {shown !== undefined && ENDS.has(shown.status) ? (
        <p className="text-text-muted text-sm">{t('logNow')}</p>
      ) : null}
      {refused.length === 0 ? null : (
        <div className="flex flex-col gap-1 text-sm" role="alert">
          <p>{t('refused')}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {refused.map((reason) => (
              <li key={reason}>{refusalT(reason)}</li>
            ))}
          </ul>
        </div>
      )}
      <FailureMessage failure={dial.failure ?? ready.failure} />
    </section>
  );
}
