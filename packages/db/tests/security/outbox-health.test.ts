import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeOutboxDb } from '../../src/outbox-client';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(async () => {
  await asMigrator(
    (m) => m`update outbox_events set published_at = now()
              where aggregate_type = ${TAG} and published_at is null and dead_lettered_at is null`,
  );
  await closeOutboxDb();
  await closeDb();
});

/** Rows this file writes carry their own type and aggregate type, so no other suite's rows count. */
const SUFFIX = newId()
  .replace(/[^a-f]/g, '')
  .slice(0, 8)
  .padEnd(8, 'a');
const TYPE = `testhealth.seen_${SUFFIX}`;
const TAG = `test_health_${SUFFIX}`;

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

interface Row {
  entity?: number;
  deadLettered?: string | null;
  error?: string | null;
  nextAttempt?: string | null;
  claimed?: string | null;
}

/** An outbox row written as the owner; the moments are intervals from now (negative is past). */
async function event(row: Row): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`
      insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id, payload_json,
                                 attempts, last_error, dead_lettered_at, next_attempt_at,
                                 claimed_until)
      values (${id}, ${row.entity ?? 1}, ${TYPE}, ${TAG}, ${newId()},
              '{"v": 1, "secret": "a payload the page never shows"}'::jsonb,
              ${row.deadLettered == null ? 1 : 10}, ${row.error ?? null},
              now() - ${row.deadLettered ?? null}::interval,
              now() + ${row.nextAttempt ?? null}::interval,
              now() + ${row.claimed ?? null}::interval)`,
  );
  return id;
}

interface Health {
  byType: { type: string; pending: number; due: number; deadLettered: number }[];
  deadLetters: {
    total: number;
    items: (Record<string, unknown> & { eventId: string; cursorAt: string })[];
  };
}

function health(
  principal: Principal,
  cursor: { at: string; id: string } | null = null,
  limit = 200,
): Promise<Health> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(sql`
      select app.outbox_health(${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::uuid,
                               ${limit}::int) as h`)) as unknown as { h: Health }[];
    const answer = rows[0]?.h;
    if (answer === undefined) throw new Error('no answer');
    return answer;
  });
}

const executive = (entities: number[] = [1, 2, 3, 4]) => principalFor('executive', entities);
const ours = (h: Health) => h.byType.find((t) => t.type === TYPE);

describe('app.outbox_health() (Integration Health, docs/03-roadmap-appendix/phase1.md §5.2)', () => {
  it('may be called by the application and the reader only', async () => {
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.outbox_health(timestamptz,uuid,integer)', 'execute') as app,
             has_function_privilege('app_reader', 'app.outbox_health(timestamptz,uuid,integer)', 'execute') as reader,
             has_function_privilege('auth_service', 'app.outbox_health(timestamptz,uuid,integer)', 'execute') as auth,
             has_function_privilege('outbox_publisher', 'app.outbox_health(timestamptz,uuid,integer)', 'execute') as outbox,
             has_function_privilege('readonly_reporter', 'app.outbox_health(timestamptz,uuid,integer)', 'execute') as reporter,
             has_function_privilege('public', 'app.outbox_health(timestamptz,uuid,integer)', 'execute') as pub
    `);
    expect(grants).toEqual({
      app: true,
      reader: true,
      auth: false,
      outbox: false,
      reporter: false,
      pub: false,
    });
  });

  it('refuses anyone without admin.integrations.write at scope all, and a call with no context', async () => {
    for (const role of ['general_manager', 'accounts', 'agent:chief', 'system:workers'] as const) {
      expect(await failure(health(principalFor(role, [1])))).toMatch(
        /admin\.integrations\.write:all is required/,
      );
    }
    const empty = principalFor('executive', []);
    expect(await failure(health(empty))).toMatch(/admin\.integrations\.write:all is required/);
    expect(await failure(withoutContext(sql`select app.outbox_health(null, null, 10)`))).toMatch(
      /admin\.integrations\.write:all is required/,
    );
  });

  it('counts pending, due and dead-lettered events by type, due by backoff and lease', async () => {
    await event({ nextAttempt: '1 hour' }); // pending, waiting out its backoff
    await event({ claimed: '2 minutes' }); // pending, leased to a live run
    await event({ deadLettered: '1 minute', error: 'queue_refused' });
    const due = await event({ nextAttempt: '-1 minute' });
    // Held locked, so a publisher run in another suite skips it while it is counted here.
    await asMigrator((holder) =>
      holder.begin(async (tx) => {
        await tx`select id from outbox_events where id = ${due} for update`;
        expect(ours(await health(executive()))).toMatchObject({
          pending: 3,
          due: 1,
          deadLettered: 1,
        });
        await tx`update outbox_events set published_at = now() where id = ${due}`;
      }),
    );
    expect(ours(await health(executive()))).toMatchObject({ pending: 2, due: 0, deadLettered: 1 });
  });

  it('answers only the companies of the request', async () => {
    const before = ours(await health(executive([2])))?.deadLettered ?? 0;
    await event({ entity: 2, deadLettered: '1 minute', error: 'no_outcome' });
    // Company 4, not 3: the end-to-end snapshot company shows its outbox (e2e/support/users.ts).
    await event({ entity: 4, deadLettered: '1 minute', error: 'no_outcome' });
    expect(ours(await health(executive([2])))?.deadLettered).toBe(before + 1);
    const items = (await health(executive([2]))).deadLetters.items.filter(
      (i) => i.aggregateType === TAG,
    );
    expect(new Set(items.map((i) => i.entityId))).toEqual(new Set([2]));
  });

  it('never answers a payload, and an error only when it is a code', async () => {
    const coded = await event({ deadLettered: '2 minutes', error: 'TimeoutError' });
    const text = await event({ deadLettered: '2 minutes', error: 'http_503 upstream said no' });
    const answer = await health(executive());
    expect(JSON.stringify(answer)).not.toContain('a payload the page never shows');
    const byId = new Map(answer.deadLetters.items.map((i) => [i.eventId, i]));
    expect(byId.get(coded)).toMatchObject({ errorCode: 'TimeoutError', attempts: 10, type: TYPE });
    expect(byId.get(text)?.errorCode).toBe('other');
    expect(Object.keys(byId.get(coded) ?? {}).sort()).toEqual(
      [
        'aggregateId',
        'aggregateType',
        'attempts',
        'createdAt',
        'cursorAt',
        'deadLetteredAt',
        'entityId',
        'errorCode',
        'eventId',
        'type',
      ].sort(),
    );
  });

  it('pages the dead letters newest first, one more than the limit, after the cursor', async () => {
    const ids = [];
    for (const age of ['10 seconds', '20 seconds', '30 seconds']) {
      ids.push(await event({ deadLettered: age, error: 'no_answer' }));
    }
    const first = await health(executive(), null, 1);
    expect(first.deadLetters.items).toHaveLength(2);
    const seen: string[] = [];
    let cursor: { at: string; id: string } | null = null;
    for (let page = 0; page < 500; page += 1) {
      const answer: Health = await health(executive(), cursor, 5);
      const items = answer.deadLetters.items.slice(0, 5);
      seen.push(...items.map((i) => i.eventId));
      const last = items.at(-1);
      if (answer.deadLetters.items.length <= 5 || last === undefined) break;
      cursor = { at: last.cursorAt, id: last.eventId };
    }
    expect(new Set(seen).size).toBe(seen.length);
    const order = ids.map((id) => seen.indexOf(id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Other suites may dead-letter events meanwhile, so the total is checked against this file's.
    expect(first.deadLetters.total).toBeGreaterThanOrEqual(ids.length);
    expect(seen.length).toBeGreaterThanOrEqual(ids.length);
  });
});
