import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeOutboxDb } from '../../src/outbox-client';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

/** Every row this file writes carries its own aggregate type, so other suites' rows never count. */
const TAG = `test_replay_${newId().slice(-8)}`;

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

/** A dead letter as the publisher leaves it after its tenth failed attempt. */
async function deadLetter(): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id,
                                        payload_json, attempts, last_error, dead_lettered_at)
             values (${id}, 1, 'admin.user.reactivated', ${TAG}, ${newId()}, '{"v": 1}'::jsonb,
                     10, 'http_404', now())`,
  );
  return id;
}

async function row(id: string) {
  const [found] = await asOutboxPublisher(
    (p) => p<
      {
        attempts: number;
        last_error: string | null;
        dead_lettered_at: Date | null;
        published_at: Date | null;
      }[]
    >`select attempts, last_error, dead_lettered_at, published_at from outbox_events
       where id = ${id}`,
  );
  return found;
}

function replay(principal: Principal, id: string) {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select * from app.replay_dead_letter(${id}::uuid)`,
    )) as unknown as { was_dead_lettered_at: string | null; previous_attempts: number }[];
    return rows;
  });
}

describe('app.replay_dead_letter() (integrations.dlq.replay, design §4.4)', () => {
  it('only the application role may call it', async () => {
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.replay_dead_letter(uuid)', 'execute') as app,
             has_function_privilege('auth_service', 'app.replay_dead_letter(uuid)', 'execute') as auth,
             has_function_privilege('outbox_publisher', 'app.replay_dead_letter(uuid)', 'execute') as outbox,
             has_function_privilege('readonly_reporter', 'app.replay_dead_letter(uuid)', 'execute') as reporter,
             has_function_privilege('public', 'app.replay_dead_letter(uuid)', 'execute') as pub
    `);
    expect(grants).toEqual({ app: true, auth: false, outbox: false, reporter: false, pub: false });
  });

  it('refuses a caller without the permission, and a call with no context', async () => {
    const id = await deadLetter();
    for (const role of ['general_manager', 'accounts', 'agent:triage'] as const) {
      // No principals row: an agent row would change the agent count fail-closed.test.ts checks.
      const principal = principalFor(role);
      expect(await failure(replay(principal, id)), role).toMatch(/integrations\.dlq\.replay/);
    }
    expect(
      await failure(withoutContext(sql`select * from app.replay_dead_letter(${id}::uuid)`)),
    ).toMatch(/integrations\.dlq\.replay/);
    expect(await row(id)).toMatchObject({ attempts: 10, last_error: 'http_404' });
  });

  it('puts a dead letter back in the queue with its attempts and error cleared', async () => {
    const id = await deadLetter();
    const executive = await createTestPrincipal('executive');
    const [answer] = await replay(executive, id);
    expect(answer?.previous_attempts).toBe(10);
    expect(answer?.was_dead_lettered_at).not.toBeNull();
    expect(await row(id)).toEqual({
      attempts: 0,
      last_error: null,
      dead_lettered_at: null,
      published_at: null,
    });
    // The publisher then delivers it as it would any pending event.
    await asOutboxPublisher(
      (p) => p`update outbox_events set published_at = now() where id = ${id}`,
    );
    expect((await row(id))?.published_at).toBeInstanceOf(Date);
  });

  it('leaves an event that is not dead-lettered as it is, and answers nothing for an unknown one', async () => {
    const executive = await createTestPrincipal('executive');
    const id = await deadLetter();
    await replay(executive, id);
    const [again] = await replay(executive, id);
    expect(again?.was_dead_lettered_at).toBeNull();
    expect(await row(id)).toMatchObject({ attempts: 0, dead_lettered_at: null });
    expect(await replay(executive, newId())).toEqual([]);
  });

  it('is the only way a dead letter changes: the trigger refuses everything else, the owner included', async () => {
    const id = await deadLetter();
    // Each change runs on its own, one after another, so no refusal goes unobserved.
    for (const change of [
      () =>
        asOutboxPublisher(
          (p) => p`update outbox_events set dead_lettered_at = null, attempts = 0, last_error = null
                  where id = ${id}`,
        ),
      () =>
        asOutboxPublisher((p) => p`update outbox_events set published_at = now() where id = ${id}`),
      () => asOutboxPublisher((p) => p`update outbox_events set attempts = 11 where id = ${id}`),
      () =>
        asMigrator(
          (m) => m`update outbox_events set dead_lettered_at = null, attempts = 0, last_error = null
                  where id = ${id}`,
        ),
      // A setting naming another event does not open this one.
      () =>
        asMigrator((m) =>
          m.begin(async (tx) => {
            await tx`select set_config('app.dlq_replay', ${newId()}, true)`;
            await tx`update outbox_events set dead_lettered_at = null, attempts = 0, last_error = null
                    where id = ${id}`;
          }),
        ),
      // Even the replay setting allows only the reset, not a half reset or a delivery.
      () =>
        asMigrator((m) =>
          m.begin(async (tx) => {
            await tx`select set_config('app.dlq_replay', ${id}, true)`;
            await tx`update outbox_events set dead_lettered_at = null where id = ${id}`;
          }),
        ),
    ]) {
      expect(await failure(change())).toMatch(/changes only by a replay/);
    }
    expect(await row(id)).toMatchObject({ attempts: 10, last_error: 'http_404' });
    expect((await row(id))?.dead_lettered_at).toBeInstanceOf(Date);
  });

  it('still refuses a change outside the delivery columns, and a delete, on any event', async () => {
    const id = await deadLetter();
    expect(
      await failure(
        asMigrator((m) => m`update outbox_events set aggregate_id = 'other' where id = ${id}`),
      ),
    ).toMatch(/only the delivery columns/);
    expect(await failure(asMigrator((m) => m`delete from outbox_events where id = ${id}`))).toMatch(
      /append-only/,
    );
  });

  it('app_user still cannot update the outbox directly', async () => {
    const id = await deadLetter();
    const executive = await createTestPrincipal('executive');
    expect(
      await failure(
        asPrincipal(executive, ({ tx }) =>
          tx.execute(sql`update outbox_events set attempts = 0 where id = ${id}`),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe('a replay with backoff and leases (migration 0054)', () => {
  /** A dead letter that still carries a backoff and a lease, as one left by an older run could. */
  async function deadLetterWithLease(): Promise<string> {
    const id = newId();
    await asMigrator(
      (m) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id,
                                          payload_json, attempts, last_error, dead_lettered_at,
                                          next_attempt_at, claimed_until)
               values (${id}, 1, 'admin.user.reactivated', ${TAG}, ${newId()}, '{"v": 1}'::jsonb,
                       10, 'http_404', now(), now() + interval '1 hour',
                       now() + interval '2 minutes')`,
    );
    return id;
  }

  async function delivery(id: string) {
    const [found] = await asOutboxPublisher(
      (p) => p<{ backoff: boolean; lease: boolean; dead: boolean }[]>`
        select next_attempt_at is not null as backoff, claimed_until is not null as lease,
               dead_lettered_at is not null as dead
          from outbox_events where id = ${id}`,
    );
    return found;
  }

  it('clears the backoff and the lease, so the event is due at once', async () => {
    const id = await deadLetterWithLease();
    const executive = await createTestPrincipal('executive');
    await replay(executive, id);
    expect(await delivery(id)).toEqual({ backoff: false, lease: false, dead: false });
    expect(await row(id)).toMatchObject({ attempts: 0, last_error: null });
    await asOutboxPublisher(
      (p) => p`update outbox_events set published_at = now() where id = ${id}`,
    );
  });

  it('refuses a new backoff or lease on a dead letter, and a reset that leaves either', async () => {
    const id = await deadLetterWithLease();
    for (const change of [
      () =>
        asOutboxPublisher(
          (p) => p`update outbox_events set next_attempt_at = now() where id = ${id}`,
        ),
      () =>
        asOutboxPublisher(
          (p) => p`update outbox_events set claimed_until = now() + interval '1 hour'
                  where id = ${id}`,
        ),
      // The replay setting allows only the whole reset, the backoff and the lease included.
      () =>
        asMigrator((m) =>
          m.begin(async (tx) => {
            await tx`select set_config('app.dlq_replay', ${id}, true)`;
            await tx`update outbox_events set dead_lettered_at = null, attempts = 0,
                                              last_error = null
                    where id = ${id}`;
          }),
        ),
    ]) {
      expect(await failure(change())).toMatch(/changes only by a replay/);
    }
    expect(await delivery(id)).toEqual({ backoff: true, lease: true, dead: true });
  });
});
