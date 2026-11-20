import { newId, SYSTEM_WORKERS_PRINCIPAL_ID } from '@shakti/contracts';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestVoicePrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// G2's Phase 2 alerts (docs/03-roadmap-appendix/phase2.md §8.1): `app.alert_counts()` is the
// hourly jobs check's read of the webhooks, the agents' caps and the day's voice use, which only
// the workers principal may call (ADR 0020) and which answers counts, ids, codes and times only.

afterAll(async () => {
  await closeDb();
});

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

/** A rollback that carries the answer out of a transaction the test must leave as it found it. */
class Undo<T> extends Error {
  constructor(readonly answer: T) {
    super('undo');
  }
}

interface Counts {
  companies: { entityId: number; code: string; whatsapp: boolean }[];
  webhooks: {
    provider: string;
    failedLastHour: number;
    waiting: number;
    oldestWaitingSeconds: number | null;
  }[];
  agentCaps: { agent: string; entityId: number | null; capPaise: number }[];
  voice: { userId: string; minutes: number; spentPaise: number }[];
}

const call = sql`select app.alert_counts() as counts`;
const workers = () => principalFor('system:workers', [], { id: SYSTEM_WORKERS_PRINCIPAL_ID });

describe('app.alert_counts() (G2 alerts)', () => {
  it('only the request roles may call it', async () => {
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.alert_counts()', 'execute') as app,
             has_function_privilege('app_reader', 'app.alert_counts()', 'execute') as reader,
             has_function_privilege('auth_service', 'app.alert_counts()', 'execute') as auth,
             has_function_privilege('outbox_publisher', 'app.alert_counts()', 'execute') as outbox,
             has_function_privilege('webhook_receiver', 'app.alert_counts()', 'execute') as receiver,
             has_function_privilege('readonly_reporter', 'app.alert_counts()', 'execute') as reporter,
             has_function_privilege('public', 'app.alert_counts()', 'execute') as pub
    `);
    expect(grants).toEqual({
      app: true,
      reader: true,
      auth: false,
      outbox: false,
      receiver: false,
      reporter: false,
      pub: false,
    });
  });

  it('refuses every person, agent and voice session, even the Executive, and a call with no context', async () => {
    const callers = [
      principalFor('executive'),
      principalFor('general_manager', [1]),
      principalFor('accounts', [1]),
      principalFor('tele_caller_cc', [1]),
      principalFor('agent:triage', [1]),
      principalFor('agent:chief', [1]),
      await createTestVoicePrincipal('executive'),
    ];
    for (const principal of callers) {
      expect(
        await failure(asPrincipal(principal, ({ tx }) => tx.execute(call))),
        `${principal.roleKey} ${principal.kind}`,
      ).toMatch(/platform\.jobs\.check:all is required/);
    }
    expect(await failure(withoutContext(call))).toMatch(/platform\.jobs\.check:all is required/);
  });

  it('answers the workers principal with no company: every company and provider, counts only', async () => {
    const counts = await asPrincipal(workers(), async ({ tx }) => {
      const rows = (await tx.execute(call)) as unknown as { counts: Counts }[];
      return rows[0]?.counts;
    });
    expect(Object.keys(counts ?? {}).sort()).toEqual([
      'agentCaps',
      'companies',
      'voice',
      'webhooks',
    ]);
    expect(counts?.companies.map((c) => c.entityId)).toEqual([1, 2, 3, 4]);
    for (const company of counts?.companies ?? []) {
      expect(Object.keys(company).sort()).toEqual(['code', 'entityId', 'whatsapp']);
      expect(company.code).toMatch(/^[A-Z0-9]{2,10}$/);
    }
    expect(counts?.webhooks.map((w) => w.provider)).toEqual([
      'meta_whatsapp',
      'meta_leadgen',
      'google_leadform',
      'exotel_status',
      'exotel_incoming',
      'livekit',
    ]);
    for (const webhook of counts?.webhooks ?? []) {
      expect(Object.keys(webhook).sort()).toEqual([
        'failedLastHour',
        'oldestWaitingSeconds',
        'provider',
        'waiting',
      ]);
    }
  });

  it('counts failed and waiting rows, caps and voice use, and answers no payload, number or name', async () => {
    // A payload and a display name that must never come back.
    const secretNumber = '919812345678';
    const secretName = `Never Shown ${newId().slice(-6)}`;
    const payload = { entry: [{ changes: [{ value: { from: secretNumber } }] }] };
    const sha = () => createHash('sha256').update(newId()).digest('hex');
    const person = newId();
    const session = newId();
    const before = await asPrincipal(workers(), async ({ tx }) => {
      const rows = (await tx.execute(call)) as unknown as { counts: Counts }[];
      return rows[0]?.counts;
    });
    const livekitBefore = before?.webhooks.find((w) => w.provider === 'livekit');
    // Written and read in one transaction that is rolled back, so nothing is left.
    const answer = await asMigrator(async (m) => {
      try {
        await m.begin(async (tx) => {
          for (let i = 0; i < 3; i += 1) {
            await tx`insert into webhook_inbox (id, provider, provider_event_id, payload_json,
                                                payload_sha256, received_at, attempts, failed_at,
                                                error_code)
                     values (${newId()}, 'livekit', ${`alert-failed-${newId()}`},
                             ${tx.json(payload)}, ${sha()}, now() - interval '20 minutes', 10,
                             now() - interval '5 minutes', 'handler_failed')`;
          }
          // Failed two hours ago: outside the last hour.
          await tx`insert into webhook_inbox (id, provider, provider_event_id, payload_json,
                                              payload_sha256, received_at, attempts, failed_at,
                                              error_code)
                   values (${newId()}, 'livekit', ${`alert-old-${newId()}`}, ${tx.json(payload)},
                           ${sha()}, now() - interval '3 hours', 10, now() - interval '2 hours',
                           'handler_failed')`;
          // Waiting for two hours, the oldest of its provider.
          await tx`insert into webhook_inbox (id, provider, provider_event_id, payload_json,
                                              payload_sha256, received_at)
                   values (${newId()}, 'livekit', ${`alert-waiting-${newId()}`},
                           ${tx.json(payload)}, ${sha()}, now() - interval '2 hours')`;
          await tx`insert into agent_configs (id, agent, entity_id, daily_spend_cap_paise,
                                              created_by)
                   values (${newId()}, 'agent:copilot', 3, 4321, ${SYSTEM_WORKERS_PRINCIPAL_ID})`;
          await tx`insert into principals (id, kind, display_name)
                   values (${person}, 'user', ${secretName})`;
          await tx`insert into principals (id, kind, display_name, created_by)
                   values (${session}, 'voice_session', ${secretName}, ${person})`;
          // An ended session of 20 minutes and ₹120, and an open one of 5 minutes so far.
          await tx`insert into voice_sessions (id, user_id, entity_id, entity_ids, mode,
                                               consent_recording, started_at, ended_at, minutes,
                                               max_minutes, cost_paise)
                   values (${session}, ${person}, 1, '{1}', 'ask', false,
                           now() - interval '40 minutes', now() - interval '20 minutes', 20, 30,
                           12000)`;
          const open = newId();
          await tx`insert into principals (id, kind, display_name, created_by)
                   values (${open}, 'voice_session', ${secretName}, ${person})`;
          await tx`insert into voice_sessions (id, user_id, entity_id, entity_ids, mode,
                                               consent_recording, started_at, max_minutes)
                   values (${open}, ${person}, 1, '{1}', 'ask', false,
                           now() - interval '4 minutes 30 seconds', 10)`;
          await tx`select set_config('app.permissions', 'platform.jobs.check:all', true)`;
          const [row] = await tx<{ counts: Counts }[]>`select app.alert_counts() as counts`;
          throw new Undo(row?.counts);
        });
      } catch (e) {
        if (e instanceof Undo) return e.answer as Counts;
        throw e;
      }
      return undefined;
    });
    const livekit = answer?.webhooks.find((w) => w.provider === 'livekit');
    expect(livekit?.failedLastHour).toBe((livekitBefore?.failedLastHour ?? 0) + 3);
    expect(livekit?.waiting).toBe((livekitBefore?.waiting ?? 0) + 1);
    expect(livekit?.oldestWaitingSeconds).toBeGreaterThanOrEqual(2 * 60 * 60);
    expect(answer?.agentCaps).toContainEqual({
      agent: 'agent:copilot',
      entityId: 3,
      capPaise: 4321,
    });
    expect(answer?.voice).toContainEqual({ userId: person, minutes: 25, spentPaise: 12000 });
    const text = JSON.stringify(answer);
    expect(text).not.toContain(secretNumber);
    expect(text).not.toContain(secretName);
    expect(text).not.toContain('handler_failed');
    // Nothing was left behind.
    const left = await asMigrator(
      (m) =>
        m<{ n: number }[]>`select count(*)::int as n from voice_sessions where user_id = ${person}`,
    );
    expect(left).toEqual([{ n: 0 }]);
  });
});
