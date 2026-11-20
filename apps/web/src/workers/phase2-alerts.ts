import { AGENT_ROLE_KEYS, type AgentRoleKey } from '@shakti/contracts';
import {
  AGENT_DEFAULTS,
  executeQuery,
  istCalendarDate,
  messagingHealth,
  partSpendKey,
  readAlertCounts,
  spendKey,
  WORKSHOP_DEFAULTS,
  type AlertCounts,
  type KeyValue,
} from '@shakti/domain';
import { logger } from '../log';
import type { AlertFields, AlertName, AlertSink } from '../observability/alerts';
import { qualityRating } from '../observability/whatsapp-quality';
import { systemWorkersPrincipal } from './events/system-principal';

/**
 * The thresholds of the Phase 2 alerts (docs/03-roadmap-appendix/phase2.md §8.1), in one place;
 * each alert fires at or above its threshold and stays silent below it. Each is flagged for the
 * owner to confirm; a change moves only when the owner is told.
 */
export const PHASE2_ALERT_THRESHOLDS = {
  /**
   * `webhooks.failing`: a provider's inbox rows failed in the last hour (each after its ten tries,
   * or refused by its handler for good), at or above this many: three, as `job.failing` counts
   * three failed calls in a row.
   */
  webhookFailedLastHour: 3,
  /**
   * `webhooks.backlog`: a provider's oldest waiting row has waited at least this many minutes. The
   * sweep sends a waiting row again each minute and a row's backoff after its first five handler
   * errors adds up to 31 minutes, so a row older than half an hour is stuck or failing over and
   * over.
   */
  webhookOldestWaitingMinutes: 30,
  /** `whatsapp.quality_low`: a company's number at this rating (Meta's Low, `FLAGGED`). */
  whatsappQualityLow: 'red',
  /**
   * `whatsapp.budget_high`: the portfolio's business-initiated conversations in the last 24 hours
   * at or above this share of its limit: the marketing hold's own share
   * (`WORKSHOP_DEFAULTS.whatsapp.marketingHoldShare`), so the owner is told as the hold starts.
   */
  whatsappBudgetShare: WORKSHOP_DEFAULTS.whatsapp.marketingHoldShare,
  /**
   * `ai.provider_failing` (an addition from the lead, 20-11-2026): an agent's runs recorded as
   * `unavailable` in the last hour (the AI provider did not answer, or its breaker was open), at or
   * above this many: five, the failures in a minute that open the provider's breaker
   * (`BREAKER_FAILURES`), so a passing error is not an outage.
   */
  aiUnavailableLastHour: 5,
  /** `ai.spend_high`: a spender's spend today at or above this share of a daily cap. */
  aiSpendShare: 0.8,
  /** `voice.spend_high`: a person's voice minutes or spend today at or above this share of a cap. */
  voiceShare: 0.8,
} as const;

/** The name a failed run of these alerts is told under, as a job's problem (`job.problem`). */
export const PHASE2_ALERTS_JOB = 'phase2-alerts';

/** How long one alert stands before the check raises it again for the same subject and period. */
const ALERT_AGAIN_SECONDS = 7 * 24 * 60 * 60;

/** An alert the counts call for, before the no-repeat rule. */
export interface DueAlert {
  name: AlertName;
  /**
   * What the alert is about (a provider, a company's code, a spender in a company, a person's
   * id): beside the name, its Sentry fingerprint, and its no-repeat key.
   */
  subject: string;
  /** The period it stands for: the day in India, or the quality report it is about. */
  period: string;
  fields: AlertFields;
}

/** Whether `value` is at or above `share` of `cap`; a cap of nothing is never reached. */
const atShare = (value: number, cap: number, share: number): boolean =>
  cap > 0 && value >= cap * share;

/** `webhooks.failing` and `webhooks.backlog`, per provider, once a day each. */
export function webhookAlerts(webhooks: AlertCounts['webhooks'], day: string): DueAlert[] {
  const t = PHASE2_ALERT_THRESHOLDS;
  const due: DueAlert[] = [];
  for (const w of webhooks) {
    if (w.failedLastHour >= t.webhookFailedLastHour) {
      due.push({
        name: 'webhooks.failing',
        subject: w.provider,
        period: day,
        fields: { subject: w.provider, provider: w.provider, failed: w.failedLastHour },
      });
    }
    if (
      w.oldestWaitingSeconds !== null &&
      w.oldestWaitingSeconds >= t.webhookOldestWaitingMinutes * 60
    ) {
      due.push({
        name: 'webhooks.backlog',
        subject: w.provider,
        period: day,
        fields: {
          subject: w.provider,
          provider: w.provider,
          waiting: w.waiting,
          oldestMinutes: Math.floor(w.oldestWaitingSeconds / 60),
        },
      });
    }
  }
  return due;
}

/** What the key-value store holds of a company's number: Meta's last quality event and when. */
export interface NumberQualityCount {
  entityId: number;
  event: string | null;
  at: string | null;
}

/**
 * `whatsapp.quality_low`, per company with an active number at Low, once per quality report (and
 * again after a week while the same report stands).
 */
export function qualityAlerts(
  companies: AlertCounts['companies'],
  quality: readonly NumberQualityCount[],
): DueAlert[] {
  const due: DueAlert[] = [];
  for (const company of companies) {
    if (!company.whatsapp) continue;
    const q = quality.find((n) => n.entityId === company.entityId);
    if (q === undefined || qualityRating(q.event) !== PHASE2_ALERT_THRESHOLDS.whatsappQualityLow) {
      continue;
    }
    due.push({
      name: 'whatsapp.quality_low',
      subject: company.code,
      period: q.at ?? 'unknown',
      fields: { subject: company.code, company: company.code },
    });
  }
  return due;
}

/** `whatsapp.budget_high`, for the portfolio, once a day. */
export function budgetAlerts(budget: { used: number; limit: number }, day: string): DueAlert[] {
  if (!atShare(budget.used, budget.limit, PHASE2_ALERT_THRESHOLDS.whatsappBudgetShare)) return [];
  return [
    {
      name: 'whatsapp.budget_high',
      subject: 'portfolio',
      period: day,
      fields: { subject: 'portfolio', used: budget.used, limit: budget.limit },
    },
  ];
}

/** Who a day's AI spend is counted under, as `spendKey()` names it, and a part's name if any. */
export interface SpendSubject {
  spender: string;
  /** A part of the spender's work with a cap of its own (`partSpendKey()`); none for a total. */
  part?: string;
  /** The company the total is kept for; null for the group's. */
  entityId: number | null;
  /** The smallest daily cap held against this total, in paise. */
  capPaise: number;
}

/** A spend total with what it was read as. */
export interface SpendCount extends SpendSubject {
  spentPaise: number;
}

/**
 * Every daily AI spend cap and the total it is held against (the provider wrapper's
 * `passedLimit()`): for each agent, the caps set on Admin › Agents for a company (against the
 * company's total) or the group (against the group's), and the Concierge's and the Co-pilot's own
 * caps per company (`AGENT_DEFAULTS.concierge` and `.copilot.companyDailyCapPaise`); for the work
 * no agent does, the Knowledge Vault's index, its transcribing part and its search, the Playbook
 * and Ask the Business, each for the group. Where two caps hold one total, the smaller is the one
 * reached first.
 */
export function spendSubjects(
  companies: AlertCounts['companies'],
  agentCaps: AlertCounts['agentCaps'],
): SpendSubject[] {
  const ownCaps: Partial<Record<AgentRoleKey, number>> = {
    'agent:concierge': AGENT_DEFAULTS.concierge.companyDailyCapPaise,
    'agent:copilot': AGENT_DEFAULTS.copilot.companyDailyCapPaise,
  };
  const subjects: SpendSubject[] = [];
  for (const agent of AGENT_ROLE_KEYS) {
    for (const entityId of [...companies.map((c) => c.entityId), null]) {
      const caps = agentCaps
        .filter((c) => c.agent === agent && c.entityId === entityId)
        .map((c) => c.capPaise);
      const own = ownCaps[agent];
      if (entityId !== null && own !== undefined) caps.push(own);
      if (caps.length > 0) subjects.push({ spender: agent, entityId, capPaise: Math.min(...caps) });
    }
  }
  const k = AGENT_DEFAULTS.knowledge;
  subjects.push(
    { spender: k.indexName, entityId: null, capPaise: k.indexDailyCapPaise },
    {
      spender: k.indexName,
      part: k.transcribePart,
      entityId: null,
      capPaise: k.transcribeDailyCapPaise,
    },
    { spender: k.searchName, entityId: null, capPaise: k.searchDailyCapPaise },
    {
      spender: AGENT_DEFAULTS.playbook.spendName,
      entityId: null,
      capPaise: AGENT_DEFAULTS.playbook.dailyCapPaise,
    },
    {
      spender: AGENT_DEFAULTS.ask.spendName,
      entityId: null,
      capPaise: AGENT_DEFAULTS.ask.dailyCapPaise,
    },
  );
  return subjects;
}

/** The key-value key of a spend subject's total today. */
export function spendSubjectKey(subject: SpendSubject, day: string): string {
  return subject.part === undefined
    ? spendKey(subject.spender, subject.entityId, day)
    : partSpendKey(subject.spender, subject.part, day);
}

/** `ai.spend_high`, per spender and company or the group, once a day. */
export function aiSpendAlerts(
  spend: readonly SpendCount[],
  companies: AlertCounts['companies'],
  day: string,
): DueAlert[] {
  const due: DueAlert[] = [];
  for (const s of spend) {
    if (!atShare(s.spentPaise, s.capPaise, PHASE2_ALERT_THRESHOLDS.aiSpendShare)) continue;
    const company =
      s.entityId === null
        ? 'group'
        : (companies.find((c) => c.entityId === s.entityId)?.code ?? String(s.entityId));
    // An agent by its name (`concierge`), other work by its spend name (`knowledge:ask`).
    const agent = [
      s.spender.replace(/^agent:/, ''),
      ...(s.part === undefined ? [] : [s.part]),
    ].join(':');
    due.push({
      name: 'ai.spend_high',
      subject: `${agent}:${company}`,
      period: day,
      fields: {
        subject: `${agent}:${company}`,
        agent,
        company,
        spentPaise: s.spentPaise,
        capPaise: s.capPaise,
      },
    });
  }
  return due;
}

/** `ai.provider_failing`, per agent, once a day: its runs the AI provider did not answer. */
export function providerAlerts(
  unavailable: AlertCounts['agentsUnavailable'],
  day: string,
): DueAlert[] {
  return unavailable
    .filter((a) => a.unavailableLastHour >= PHASE2_ALERT_THRESHOLDS.aiUnavailableLastHour)
    .map((a) => {
      const agent = a.agent.replace(/^agent:/, '');
      return {
        name: 'ai.provider_failing' as const,
        subject: agent,
        period: day,
        fields: { subject: agent, agent, unavailable: a.unavailableLastHour },
      };
    });
}

/** `voice.spend_high`, per person, once a day, when their minutes or spend near a day's cap. */
export function voiceAlerts(voice: AlertCounts['voice'], day: string): DueAlert[] {
  const v = AGENT_DEFAULTS.voice;
  const share = PHASE2_ALERT_THRESHOLDS.voiceShare;
  return voice
    .filter(
      (p) =>
        atShare(p.minutes, v.personDailyMinutes, share) ||
        atShare(p.spentPaise, v.personDailyCapPaise, share),
    )
    .map((p) => ({
      name: 'voice.spend_high' as const,
      subject: p.userId,
      period: day,
      fields: {
        subject: p.userId,
        person: p.userId,
        minutes: p.minutes,
        minutesCap: v.personDailyMinutes,
        spentPaise: p.spentPaise,
        capPaise: v.personDailyCapPaise,
      },
    }));
}

/**
 * Raises each due alert once per subject and period: the first check to see it raises it, and
 * the store holds that for a week, so an alert that stands is not raised every hour. Without the
 * store the check cannot tell a repeat, and tells (as `job.problem` does). Answers how many it
 * raised.
 */
export async function raiseOnce(
  due: readonly DueAlert[],
  options: { requestId: string; keyValue: KeyValue; alerts: AlertSink },
): Promise<number> {
  let alerted = 0;
  for (const alert of due) {
    const key = `alert:${alert.name}:${alert.subject}:${alert.period}`;
    let first: boolean;
    try {
      first = await options.keyValue.setIfAbsent(key, '1', ALERT_AGAIN_SECONDS);
    } catch (storeError) {
      logger.log('warn', 'alerts.not_kept', {
        requestId: options.requestId,
        alert: alert.name,
        error: storeError,
      });
      first = true;
    }
    if (!first) continue;
    await options.alerts.report(alert.name, alert.fields);
    alerted += 1;
  }
  return alerted;
}

export interface Phase2AlertOptions {
  requestId: string;
  keyValue: KeyValue;
  alerts: AlertSink;
  now: Date;
  /** The database's counts; by default `app.alert_counts()` as `system:workers`. */
  readCounts?: () => Promise<AlertCounts>;
}

/**
 * The Phase 2 alerts of the hourly jobs check (docs/03-roadmap-appendix/phase2.md §8.1): reads the
 * database's counts as `system:workers` through `app.alert_counts()` (`platform.jobs.check`, no
 * company, no person's grant), and the WhatsApp quality, the portfolio's budget and the day's AI
 * spend from the key-value store, as Integration Health and the spend caps read them; raises each
 * alert due once per subject and period. A failed read rejects; the jobs check tells it as a
 * problem of its own (`job.problem`, `phase2-alerts`) and carries on.
 */
export async function runPhase2Alerts(
  options: Phase2AlertOptions,
): Promise<{ due: number; alerted: number }> {
  const { requestId, keyValue, now } = options;
  const day = istCalendarDate(now);
  const counts = await (
    options.readCounts ??
    (() =>
      executeQuery(systemWorkersPrincipal(null), { entityIds: [], requestId }, readAlertCounts, {
        name: 'alertCounts',
      }))
  )();
  const messaging = await messagingHealth(
    keyValue,
    counts.companies.filter((c) => c.whatsapp).map((c) => c.entityId),
    now,
  );
  const spend: SpendCount[] = [];
  for (const subject of spendSubjects(counts.companies, counts.agentCaps)) {
    const raw = await keyValue.get(spendSubjectKey(subject, day));
    const spentPaise = raw === null ? 0 : Number(raw);
    spend.push({ ...subject, spentPaise: Number.isFinite(spentPaise) ? spentPaise : 0 });
  }
  const due = [
    ...webhookAlerts(counts.webhooks, day),
    ...qualityAlerts(counts.companies, messaging.quality),
    ...budgetAlerts(messaging, day),
    ...aiSpendAlerts(spend, counts.companies, day),
    ...providerAlerts(counts.agentsUnavailable, day),
    ...voiceAlerts(counts.voice, day),
  ];
  const alerted = await raiseOnce(due, options);
  logger.log('info', 'alerts.checked', { requestId, due: due.length, alerted });
  return { due: due.length, alerted };
}
