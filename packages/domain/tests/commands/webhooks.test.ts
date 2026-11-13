import { newId, type MarkWebhookInput, type Principal } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, principalFor } from '@shakti/db/testing';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { failureOf, runCommand } from '../../src/command/run-command';
import { claimWebhook, markWebhook } from '../../src/commands/webhooks/inbox';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// The webhook worker's commands on real Postgres (docs/03-roadmap-appendix/phase2.md §5.1): the
// platform-only `webhooks.process` held by `system:workers` alone, over `webhook_inbox`.

afterAll(closeDb);

const workers = principalFor('system:workers', []);

/** A stored delivery of this run's own. */
async function stored(provider = 'livekit'): Promise<string> {
  const id = newId();
  const hash = createHash('sha256').update(id).digest('hex');
  await asMigrator(
    (
      m,
    ) => m`insert into webhook_inbox (id, provider, provider_event_id, payload_json, payload_sha256)
             values (${id}, ${provider}, ${`EV_${id}`}, ${JSON.stringify({ id: `EV_${id}`, event: 'room_started' })}::jsonb, ${hash})`,
  );
  return id;
}

function claim(inboxId: string, principal: Principal = workers) {
  return asPrincipal(principal, (context) =>
    runCommand(claimWebhook, { context, audit, outbox }, { inboxId }),
  );
}

function mark(input: MarkWebhookInput, principal = workers) {
  return asPrincipal(principal, (context) =>
    runCommand(markWebhook, { context, audit, outbox }, input),
  );
}

async function refusal(promise: Promise<unknown>) {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  return { code: (error as { code?: string } | undefined)?.code, stage: failureOf(error)?.stage };
}

describe('webhooks.event.claim and webhooks.event.mark', () => {
  it('are denied at the guard to every person and agent, the Executive included', async () => {
    const id = await stored();
    for (const role of ['executive', 'general_manager', 'accounts', 'agent:triage'] as const) {
      const principal = principalFor(role, [1]);
      expect({ role, ...(await refusal(claim(id, principal))) }).toEqual({
        role,
        code: 'forbidden',
        stage: 'guard',
      });
      expect({
        role,
        ...(await refusal(
          mark({ inboxId: id, lease: null, outcome: 'failed', errorCode: 'x' }, principal),
        )),
      }).toEqual({ role, code: 'forbidden', stage: 'guard' });
    }
  });

  it('refuses a company the group does not have, and a failure with no code', async () => {
    const id = await stored();
    const lease = await claim(id);
    if (!lease.claimed) throw new Error('expected a lease');
    expect(
      (
        await refusal(
          mark({ inboxId: id, lease: lease.lease, outcome: 'processed', entityId: 32_000 }),
        )
      ).code,
    ).toBe('validation_failed');
    expect((await refusal(mark({ inboxId: id, lease: lease.lease, outcome: 'failed' }))).code).toBe(
      'validation_failed',
    );
    expect((await refusal(mark({ inboxId: id, lease: null, outcome: 'processed' }))).code).toBe(
      'validation_failed',
    );
  });

  it('claims a row once, marks it processed under its lease with its company, and never again', async () => {
    const id = await stored();
    const first = await claim(id);
    expect(first).toMatchObject({ claimed: true, provider: 'livekit', attempts: 1 });
    expect(await claim(id)).toEqual({ claimed: false });
    if (!first.claimed) throw new Error('expected a lease');
    expect(
      await mark({ inboxId: id, lease: '2001-01-01 00:00:00+00', outcome: 'processed' }),
    ).toEqual({ changed: false });
    expect(
      await mark({ inboxId: id, lease: first.lease, outcome: 'processed', entityId: 3 }),
    ).toEqual({ changed: true });
    expect(await claim(id)).toEqual({ claimed: false });
    const [row] = await asMigrator(
      (m) => m<{ entity_id: number; processed: boolean }[]>`
        select entity_id, processed_at is not null as processed from webhook_inbox where id = ${id}`,
    );
    expect(row).toEqual({ entity_id: 3, processed: true });
  });

  it('a released row is claimed again; the last retry’s failure needs no lease', async () => {
    const id = await stored();
    const first = await claim(id);
    if (!first.claimed) throw new Error('expected a lease');
    expect(await mark({ inboxId: id, lease: first.lease, outcome: 'released' })).toEqual({
      changed: true,
    });
    const second = await claim(id);
    expect(second).toMatchObject({ claimed: true, attempts: 2 });
    if (!second.claimed) throw new Error('expected a lease');
    expect(
      await mark({ inboxId: id, lease: null, outcome: 'failed', errorCode: 'handler_failed' }),
    ).toEqual({ changed: false });
    await mark({ inboxId: id, lease: second.lease, outcome: 'released' });
    expect(
      await mark({ inboxId: id, lease: null, outcome: 'failed', errorCode: 'handler_failed' }),
    ).toEqual({ changed: true });
    expect(await claim(id)).toEqual({ claimed: false });
  });

  it('writes no audit row for delivery bookkeeping', async () => {
    const id = await stored();
    const requestId = newId();
    await asPrincipal(workers, async (context) => {
      const lease = await runCommand(
        claimWebhook,
        { context: { ...context, requestId }, audit, outbox },
        { inboxId: id },
      );
      if (!lease.claimed) throw new Error('expected a lease');
      await runCommand(
        markWebhook,
        { context: { ...context, requestId }, audit, outbox },
        { inboxId: id, lease: lease.lease, outcome: 'processed', errorCode: 'no_handler' },
      );
    });
    const rows = await asMigrator(
      (m) => m`select 1 from audit_logs where request_id = ${requestId}`,
    );
    expect(rows).toHaveLength(0);
  });
});
