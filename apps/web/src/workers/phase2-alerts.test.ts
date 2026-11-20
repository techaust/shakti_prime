import { AGENT_DEFAULTS, memoryKeyValue, type AlertCounts, type KeyValue } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '../log';
import { memoryAlertSink } from '../observability/alerts';
import { scrubEvent } from '../observability/sentry-scrub';
import {
  ALERT_FIELD_KEYS,
  aiSpendAlerts,
  budgetAlerts,
  providerAlerts,
  rearm,
  recoveredSubjects,
  PHASE2_ALERT_THRESHOLDS as T,
  qualityAlerts,
  raiseOnce,
  spendSubjectKey,
  spendSubjects,
  voiceAlerts,
  webhookAlerts,
  type DueAlert,
  type SpendCount,
} from './phase2-alerts';

const DAY = '2026-11-20';
const COMPANIES: AlertCounts['companies'] = [
  { entityId: 1, code: 'SS', whatsapp: true },
  { entityId: 2, code: 'SMP', whatsapp: false },
];
const PERSON = '01990000-0000-7000-8000-0000000000aa';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const webhook = (failedLastHour: number, oldestWaitingSeconds: number | null) => [
  { provider: 'meta_whatsapp' as const, failedLastHour, waiting: 4, oldestWaitingSeconds },
];

describe('webhooks.failing and webhooks.backlog', () => {
  it('fires at and above the failed rows of the last hour, and is silent below', () => {
    expect(webhookAlerts(webhook(T.webhookFailedLastHour - 1, null), DAY)).toEqual([]);
    for (const failed of [T.webhookFailedLastHour, T.webhookFailedLastHour + 5]) {
      expect(webhookAlerts(webhook(failed, null), DAY)).toEqual([
        {
          name: 'webhooks.failing',
          subject: 'meta_whatsapp',
          period: DAY,
          fields: { subject: 'meta_whatsapp', provider: 'meta_whatsapp', failed },
        },
      ]);
    }
  });

  it('fires once the oldest waiting row has waited the threshold, and not a second before', () => {
    const limit = T.webhookOldestWaitingMinutes * 60;
    expect(webhookAlerts(webhook(0, limit - 1), DAY)).toEqual([]);
    expect(webhookAlerts(webhook(0, null), DAY)).toEqual([]);
    expect(webhookAlerts(webhook(0, limit), DAY)).toEqual([
      {
        name: 'webhooks.backlog',
        subject: 'meta_whatsapp',
        period: DAY,
        fields: {
          subject: 'meta_whatsapp',
          provider: 'meta_whatsapp',
          waiting: 4,
          oldestMinutes: T.webhookOldestWaitingMinutes,
        },
      },
    ]);
    expect(webhookAlerts(webhook(0, limit + 3_600), DAY)[0]?.fields.oldestMinutes).toBe(
      T.webhookOldestWaitingMinutes + 60,
    );
  });

  it('keeps each provider apart', () => {
    const due = webhookAlerts(
      [
        { provider: 'meta_whatsapp', failedLastHour: 3, waiting: 0, oldestWaitingSeconds: null },
        { provider: 'livekit', failedLastHour: 9, waiting: 1, oldestWaitingSeconds: 7_200 },
        { provider: 'exotel_status', failedLastHour: 0, waiting: 0, oldestWaitingSeconds: null },
      ],
      DAY,
    );
    expect(due.map((a) => [a.name, a.subject])).toEqual([
      ['webhooks.failing', 'meta_whatsapp'],
      ['webhooks.failing', 'livekit'],
      ['webhooks.backlog', 'livekit'],
    ]);
  });
});

describe('whatsapp.quality_low', () => {
  const at = '2026-11-20T04:00:00.000Z';

  it('fires for a company whose number Meta flagged (Low), once per report', () => {
    expect(qualityAlerts(COMPANIES, [{ entityId: 1, event: 'FLAGGED', at }])).toEqual([
      {
        name: 'whatsapp.quality_low',
        subject: 'SS',
        period: at,
        fields: { subject: 'SS', company: 'SS' },
      },
    ]);
  });

  it('is silent at Medium, High or no report, and for a company with no active number', () => {
    for (const event of ['DOWNGRADE', 'UPGRADE', 'UNFLAGGED', null]) {
      expect(qualityAlerts(COMPANIES, [{ entityId: 1, event, at }]), String(event)).toEqual([]);
    }
    expect(qualityAlerts(COMPANIES, [{ entityId: 2, event: 'FLAGGED', at }])).toEqual([]);
    expect(qualityAlerts(COMPANIES, [])).toEqual([]);
  });
});

describe('whatsapp.budget_high', () => {
  it('fires at and above 80 % of the limit, the marketing hold’s share, and is silent below', () => {
    expect(T.whatsappBudgetShare).toBe(0.8);
    expect(budgetAlerts({ used: 199, limit: 250 }, DAY)).toEqual([]);
    for (const used of [200, 250, 400]) {
      expect(budgetAlerts({ used, limit: 250 }, DAY)).toEqual([
        {
          name: 'whatsapp.budget_high',
          subject: 'portfolio',
          period: DAY,
          fields: { subject: 'portfolio', used, limit: 250 },
        },
      ]);
    }
    expect(budgetAlerts({ used: 0, limit: 0 }, DAY)).toEqual([]);
  });
});

describe('ai.spend_high', () => {
  it('holds every daily cap against its own total, the smaller where two hold one', () => {
    const subjects = spendSubjects(COMPANIES, [
      { agent: 'agent:concierge', entityId: 1, capPaise: 10_000 },
      { agent: 'agent:concierge', entityId: null, capPaise: 30_000 },
      { agent: 'agent:triage', entityId: 2, capPaise: 70_000 },
    ]);
    const k = AGENT_DEFAULTS.knowledge;
    expect(subjects).toEqual([
      { spender: 'agent:triage', entityId: 2, capPaise: 70_000 },
      // The setting's ₹100 is below the Concierge's own ₹500 a company; the second company has
      // only its own.
      { spender: 'agent:concierge', entityId: 1, capPaise: 10_000 },
      {
        spender: 'agent:concierge',
        entityId: 2,
        capPaise: AGENT_DEFAULTS.concierge.companyDailyCapPaise,
      },
      { spender: 'agent:concierge', entityId: null, capPaise: 30_000 },
      {
        spender: 'agent:copilot',
        entityId: 1,
        capPaise: AGENT_DEFAULTS.copilot.companyDailyCapPaise,
      },
      {
        spender: 'agent:copilot',
        entityId: 2,
        capPaise: AGENT_DEFAULTS.copilot.companyDailyCapPaise,
      },
      { spender: k.indexName, entityId: null, capPaise: k.indexDailyCapPaise },
      {
        spender: k.indexName,
        part: 'transcribe',
        entityId: null,
        capPaise: k.transcribeDailyCapPaise,
      },
      { spender: k.searchName, entityId: null, capPaise: k.searchDailyCapPaise },
      {
        spender: 'knowledge:playbook',
        entityId: null,
        capPaise: AGENT_DEFAULTS.playbook.dailyCapPaise,
      },
      { spender: 'knowledge:ask', entityId: null, capPaise: AGENT_DEFAULTS.ask.dailyCapPaise },
    ]);
  });

  it('reads each total from the key the spend caps count it under', () => {
    expect(spendSubjectKey({ spender: 'agent:concierge', entityId: 1, capPaise: 1 }, DAY)).toBe(
      `ai:spend:agent:concierge:1:${DAY}`,
    );
    expect(spendSubjectKey({ spender: 'knowledge:ask', entityId: null, capPaise: 1 }, DAY)).toBe(
      `ai:spend:knowledge:ask:all:${DAY}`,
    );
    expect(
      spendSubjectKey(
        { spender: 'knowledge:index', part: 'transcribe', entityId: null, capPaise: 1 },
        DAY,
      ),
    ).toBe(`ai:spend:knowledge:index:part:transcribe:${DAY}`);
  });

  const spent = (spentPaise: number, over: Partial<SpendCount> = {}): SpendCount[] => [
    { spender: 'agent:concierge', entityId: 1, capPaise: 10_000, spentPaise, ...over },
  ];

  it('fires at and above 80 % of the cap, per agent and company, and is silent below', () => {
    expect(T.aiSpendShare).toBe(0.8);
    expect(aiSpendAlerts(spent(7_999), COMPANIES, DAY)).toEqual([]);
    for (const paise of [8_000, 10_000, 12_500]) {
      expect(aiSpendAlerts(spent(paise), COMPANIES, DAY)).toEqual([
        {
          name: 'ai.spend_high',
          subject: 'concierge:SS',
          period: DAY,
          fields: {
            subject: 'concierge:SS',
            agent: 'concierge',
            company: 'SS',
            spentPaise: paise,
            capPaise: 10_000,
          },
        },
      ]);
    }
  });

  it('names the group’s totals and a part of the work by their own names', () => {
    const due = aiSpendAlerts(
      [
        { spender: 'agent:concierge', entityId: null, capPaise: 1_000, spentPaise: 900 },
        {
          spender: 'knowledge:index',
          part: 'transcribe',
          entityId: null,
          capPaise: 30_000,
          spentPaise: 24_000,
        },
        { spender: 'knowledge:ask', entityId: null, capPaise: 100_000, spentPaise: 79_999 },
      ],
      COMPANIES,
      DAY,
    );
    expect(due.map((a) => a.subject)).toEqual([
      'concierge:group',
      'knowledge:index:transcribe:group',
    ]);
  });
});

describe('ai.provider_failing (an addition from the lead)', () => {
  const runs = (unavailableLastHour: number) => [
    { agent: 'agent:concierge' as const, unavailableLastHour },
  ];

  it('fires at and above the runs the provider did not answer in the last hour, silent below', () => {
    expect(providerAlerts(runs(T.aiUnavailableLastHour - 1), DAY)).toEqual([]);
    for (const n of [T.aiUnavailableLastHour, T.aiUnavailableLastHour + 40]) {
      expect(providerAlerts(runs(n), DAY)).toEqual([
        {
          name: 'ai.provider_failing',
          subject: 'concierge',
          period: DAY,
          fields: { subject: 'concierge', agent: 'concierge', unavailable: n },
        },
      ]);
    }
  });

  it('keeps each agent apart', () => {
    const due = providerAlerts(
      [
        { agent: 'agent:triage', unavailableLastHour: 9 },
        { agent: 'agent:copilot', unavailableLastHour: 1 },
        { agent: 'agent:concierge', unavailableLastHour: 5 },
      ],
      DAY,
    );
    expect(due.map((a) => a.subject)).toEqual(['triage', 'concierge']);
  });
});

describe('voice.spend_high', () => {
  const v = AGENT_DEFAULTS.voice;
  const person = (minutes: number, spentPaise: number) => [{ userId: PERSON, minutes, spentPaise }];

  it('fires at and above 80 % of the day’s minutes or spend, and is silent below both', () => {
    expect(T.voiceShare).toBe(0.8);
    expect(voiceAlerts(person(23, 15_999), DAY)).toEqual([]);
    const fired = {
      name: 'voice.spend_high',
      subject: PERSON,
      period: DAY,
      fields: {
        subject: PERSON,
        person: PERSON,
        minutes: 24,
        minutesCap: v.personDailyMinutes,
        spentPaise: 0,
        capPaise: v.personDailyCapPaise,
      },
    };
    expect(voiceAlerts(person(24, 0), DAY)).toEqual([fired]);
    expect(voiceAlerts(person(30, 0), DAY)).toEqual([
      { ...fired, fields: { ...fired.fields, minutes: 30 } },
    ]);
    expect(voiceAlerts(person(0, 16_000), DAY)).toEqual([
      { ...fired, fields: { ...fired.fields, minutes: 0, spentPaise: 16_000 } },
    ]);
  });
});

describe('raiseOnce: one alert per subject per period', () => {
  const alert = (subject: string, period = DAY): DueAlert => ({
    name: 'webhooks.failing',
    subject,
    period,
    fields: { subject, provider: subject, failed: 3 },
  });

  it('raises an alert that stands once, though the check runs every hour', async () => {
    const keyValue = memoryKeyValue();
    const alerts = memoryAlertSink();
    const options = { requestId: 'r', keyValue, alerts };
    for (let hour = 0; hour < 24; hour += 1) {
      await raiseOnce([alert('meta_whatsapp')], options);
    }
    expect(alerts.alerts).toHaveLength(1);
  });

  it('keeps subjects and periods apart: another provider, or the next day, is told again', async () => {
    const keyValue = memoryKeyValue();
    const alerts = memoryAlertSink();
    const options = { requestId: 'r', keyValue, alerts };
    expect(await raiseOnce([alert('meta_whatsapp'), alert('livekit')], options)).toBe(2);
    expect(await raiseOnce([alert('meta_whatsapp'), alert('livekit')], options)).toBe(0);
    expect(await raiseOnce([alert('meta_whatsapp', '2026-11-21')], options)).toBe(1);
    expect(alerts.alerts.map((a) => a.fields.subject)).toEqual([
      'meta_whatsapp',
      'livekit',
      'meta_whatsapp',
    ]);
  });

  it('keeps the same subject of two alerts apart', async () => {
    const alerts = memoryAlertSink();
    const options = { requestId: 'r', keyValue: memoryKeyValue(), alerts };
    await raiseOnce([alert('livekit'), { ...alert('livekit'), name: 'webhooks.backlog' }], options);
    expect(alerts.alerts.map((a) => a.name)).toEqual(['webhooks.failing', 'webhooks.backlog']);
  });

  it('tells rather than stays silent when the store cannot say whether it told already', async () => {
    vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    const broken: KeyValue = {
      ...memoryKeyValue(),
      setIfAbsent: () => Promise.reject(new Error('offline')),
    };
    const alerts = memoryAlertSink();
    const options = { requestId: 'r', keyValue: broken, alerts };
    await raiseOnce([alert('livekit')], options);
    await raiseOnce([alert('livekit')], options);
    expect(alerts.alerts).toHaveLength(2);
    vi.restoreAllMocks();
  });
});

describe('what an alert carries: counts, ids, codes and names of jobs only', () => {
  /** One of each of the seven alerts, from synthetic counts. */
  const everyAlert = (): DueAlert[] => [
    ...webhookAlerts(webhook(9, 7_200), DAY),
    ...qualityAlerts(COMPANIES, [{ entityId: 1, event: 'FLAGGED', at: '2026-11-20T04:00:00Z' }]),
    ...budgetAlerts({ used: 240, limit: 250 }, DAY),
    ...aiSpendAlerts(
      [
        { spender: 'agent:concierge', entityId: 1, capPaise: 10_000, spentPaise: 9_000 },
        {
          spender: 'knowledge:index',
          part: 'transcribe',
          entityId: null,
          capPaise: 30_000,
          spentPaise: 29_000,
        },
      ],
      COMPANIES,
      DAY,
    ),
    ...providerAlerts([{ agent: 'agent:copilot', unavailableLastHour: 12 }], DAY),
    ...voiceAlerts([{ userId: PERSON, minutes: 29, spentPaise: 19_000 }], DAY),
  ];

  it('covers every Phase 2 alert', () => {
    expect(new Set(everyAlert().map((a) => a.name))).toEqual(
      new Set([
        'webhooks.failing',
        'webhooks.backlog',
        'whatsapp.quality_low',
        'whatsapp.budget_high',
        'ai.spend_high',
        'ai.provider_failing',
        'voice.spend_high',
      ]),
    );
  });

  it('holds only the allowed fields, each a count or a code, id or name of a job', () => {
    for (const alert of everyAlert()) {
      for (const [key, value] of Object.entries(alert.fields)) {
        expect(ALERT_FIELD_KEYS, `${alert.name}.${key}`).toContain(key);
        if (typeof value === 'number') {
          expect(Number.isInteger(value), `${alert.name}.${key}`).toBe(true);
        } else {
          // No spaces, so never a name or a sentence; and, but for a person's id (a UUID), no run
          // of ten digits or more, so never a phone number, with or without its `+`.
          expect(value, `${alert.name}.${key}`).toMatch(/^[a-z0-9_:.-]{1,80}$/i);
          if (!UUID.test(value)) expect(value, `${alert.name}.${key}`).not.toMatch(/\d{10,}/);
        }
      }
    }
  });

  it('reaches Sentry unchanged by the scrubber, which would still mask a number slipped in', () => {
    for (const alert of everyAlert()) {
      const event = { message: alert.name, level: 'error', extra: { ...alert.fields } };
      expect(scrubEvent(event), alert.name).toEqual(event);
    }
    const slipped = scrubEvent({ message: 'ai.spend_high', extra: { agent: '+919812345678' } });
    expect(JSON.stringify(slipped)).not.toContain('9812345678');
  });
});

describe('rearm: an outage that ends is told again if it comes back the same day (review 1)', () => {
  const counts = (failedLastHour: number, unavailableLastHour: number): AlertCounts => ({
    companies: COMPANIES,
    webhooks: [
      { provider: 'meta_whatsapp', failedLastHour, waiting: 0, oldestWaitingSeconds: null },
    ],
    agentCaps: [],
    agentsUnavailable:
      unavailableLastHour === 0 ? [] : [{ agent: 'agent:concierge', unavailableLastHour }],
    voice: [],
  });

  /** One hourly run of the due and recovered steps, as `runPhase2Alerts` takes them. */
  const hour = async (
    c: AlertCounts,
    options: { requestId: string; keyValue: KeyValue; alerts: ReturnType<typeof memoryAlertSink> },
    extra: DueAlert[] = [],
  ) => {
    await rearm(recoveredSubjects(c, DAY), options);
    await raiseOnce(
      [...webhookAlerts(c.webhooks, DAY), ...providerAlerts(c.agentsUnavailable, DAY), ...extra],
      options,
    );
  };

  it('raises a provider’s failures and an agent’s unanswered runs again after they recovered', async () => {
    const alerts = memoryAlertSink();
    const options = { requestId: 'r', keyValue: memoryKeyValue(), alerts };
    await hour(counts(5, 7), options);
    await hour(counts(5, 7), options);
    await hour(counts(0, 0), options);
    await hour(counts(4, 6), options);
    expect(alerts.alerts.map((a) => `${a.name}:${String(a.fields.subject)}`)).toEqual([
      'webhooks.failing:meta_whatsapp',
      'ai.provider_failing:concierge',
      'webhooks.failing:meta_whatsapp',
      'ai.provider_failing:concierge',
    ]);
  });

  it('names only those outages below their threshold, never the spend or budget alerts', () => {
    const recovered = recoveredSubjects(counts(5, 0), DAY).map((r) => `${r.name}:${r.subject}`);
    expect(recovered).not.toContain('webhooks.failing:meta_whatsapp');
    expect(recovered).toContain('webhooks.backlog:meta_whatsapp');
    expect(recovered).toContain('ai.provider_failing:concierge');
    expect(
      recovered.every((r) =>
        /^(webhooks\.failing|webhooks\.backlog|ai\.provider_failing):/.test(r),
      ),
    ).toBe(true);
  });

  it('leaves the spend and budget alerts once a day, whatever the outages do', async () => {
    const alerts = memoryAlertSink();
    const options = { requestId: 'r', keyValue: memoryKeyValue(), alerts };
    const budget = budgetAlerts({ used: 240, limit: 250 }, DAY);
    await hour(counts(0, 0), options, budget);
    await hour(counts(0, 0), options, budget);
    expect(alerts.alerts.map((a) => a.name)).toEqual(['whatsapp.budget_high']);
  });
});
