import { newId } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { replayDeadLetter } from '../../src/commands/integrations/replay-dead-letter';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

afterAll(closeDb);

/** Every event this file writes carries its own aggregate type, so other suites' rows never count. */
const TAG = `test_dlq_${newId().slice(-8)}`;

/** An event as the publisher leaves it: dead-lettered after ten attempts, or still pending. */
async function outboxEvent(deadLettered: boolean): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id,
                                        payload_json, attempts, last_error, dead_lettered_at)
             values (${id}, 2, 'admin.user.reactivated', ${TAG}, ${newId()}, '{"v": 1}'::jsonb,
                     ${deadLettered ? 10 : 3}, 'http_404', ${deadLettered ? new Date() : null})`,
  );
  return id;
}

async function state(id: string) {
  const [row] = await asOutboxPublisher(
    (p) => p<{ attempts: number; lastError: string | null; deadLettered: boolean }[]>`
      select attempts, last_error as "lastError", dead_lettered_at is not null as "deadLettered"
        from outbox_events where id = ${id}`,
  );
  return row;
}

async function auditRows(id: string) {
  return asMigrator(
    (m) => m<{ before: unknown; after: unknown; entity: number | null; outcome: string }[]>`
      select before_json as before, after_json as after, entity_id as entity, outcome
        from audit_logs
       where aggregate_id = ${id} and command = 'integrations.dlq.replay'`,
  );
}

describe('integrations.dlq.replay (design §4.4, API §3.7)', () => {
  it('is denied without the permission and leaves the dead letter as it is', async () => {
    const id = await outboxEvent(true);
    for (const role of ['general_manager', 'accounts', 'sales_team_lead'] as const) {
      const principal = await createTestPrincipal(role);
      await expect(
        asPrincipal(principal, (context) =>
          runCommand(replayDeadLetter, { context, audit, outbox }, { eventId: id }),
        ),
        role,
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(await state(id)).toEqual({ attempts: 10, lastError: 'http_404', deadLettered: true });
  });

  it('also needs the Integration Health permission', async () => {
    const id = await outboxEvent(true);
    const exec = await createTestPrincipal('executive');
    const withoutPage = {
      ...exec,
      permissions: exec.permissions.filter((g) => g.key !== 'admin.integrations.write'),
    };
    await expect(
      asPrincipal(withoutPage, (context) =>
        runCommand(replayDeadLetter, { context, audit, outbox }, { eventId: id }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await state(id)).toMatchObject({ deadLettered: true });
  });

  it('answers an event of another company as unknown and leaves it dead-lettered', async () => {
    const id = await outboxEvent(true);
    const narrow = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(narrow, (context) =>
        runCommand(replayDeadLetter, { context, audit, outbox }, { eventId: id }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'dead_letter_missing' } });
    expect(await state(id)).toEqual({ attempts: 10, lastError: 'http_404', deadLettered: true });
  });

  it('puts a dead letter back in the queue and writes one audit row', async () => {
    const id = await outboxEvent(true);
    const exec = await createTestPrincipal('executive');
    const dto = await asPrincipal(exec, (context) =>
      runCommand(replayDeadLetter, { context, audit, outbox }, { eventId: id }),
    );
    expect(dto).toEqual({ eventId: id, requeued: true, attempts: 0 });
    expect(await state(id)).toEqual({ attempts: 0, lastError: null, deadLettered: false });

    const rows = await auditRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity: null,
      outcome: 'ok',
      before: { attempts: 10 },
      after: {
        attempts: 0,
        deadLetteredAt: null,
        eventType: 'admin.user.reactivated',
        eventEntityId: 2,
      },
    });
    expect((rows[0]?.before as { deadLetteredAt?: string }).deadLetteredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });

  it('answers not_dead_lettered for a pending or replayed event, and not_found for an unknown one', async () => {
    const exec = await createTestPrincipal('executive');
    const pending = await outboxEvent(false);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(replayDeadLetter, { context, audit, outbox }, { eventId: pending }),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'not_dead_lettered' } });
    expect(await state(pending)).toEqual({
      attempts: 3,
      lastError: 'http_404',
      deadLettered: false,
    });

    const replayed = await outboxEvent(true);
    await asPrincipal(exec, (context) =>
      runCommand(replayDeadLetter, { context, audit, outbox }, { eventId: replayed }),
    );
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(replayDeadLetter, { context, audit, outbox }, { eventId: replayed }),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'not_dead_lettered' } });

    await expect(
      asPrincipal(exec, (context) =>
        runCommand(replayDeadLetter, { context, audit, outbox }, { eventId: newId() }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'dead_letter_missing' } });
  });
});
