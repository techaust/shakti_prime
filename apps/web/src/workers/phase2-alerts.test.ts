import { AGENT_DEFAULTS, memoryKeyValue, type AlertCounts, type KeyValue } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '../log';
import { memoryAlertSink } from '../observability/alerts';
import {
  aiSpendAlerts,
  budgetAlerts,
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
