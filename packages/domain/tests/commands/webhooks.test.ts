import { newId, type MarkWebhookInput, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { failureOf, runCommand } from '../../src/command/run-command';
import {
  claimWebhook,
  markWebhook,
  replayWebhook,
  sweepWebhooks,
} from '../../src/commands/webhooks/inbox';
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
             values (${id}, ${provider}, ${`EV_${id}`}, ${JSON.stringify({ id: `EV_${id}`, event: 'room_started' })}::text::jsonb, ${hash})`,
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

  it('a released row waits its backoff; the last retry\u2019s failure needs no lease', async () => {
    const id = await stored();
    const first = await claim(id);
    if (!first.claimed) throw new Error('expected a lease');
    expect(
      await mark({ inboxId: id, lease: null, outcome: 'failed', errorCode: 'handler_failed' }),
    ).toEqual({ changed: false });
    expect(await mark({ inboxId: id, lease: first.lease, outcome: 'released' })).toEqual({
      changed: true,
    });
    expect(await claim(id)).toEqual({ claimed: false });
    await asMigrator((m) => m`update webhook_inbox set retry_at = now() where id = ${id}`);
    const second = await claim(id);
    expect(second).toMatchObject({ claimed: true, attempts: 2 });
    if (!second.claimed) throw new Error('expected a lease');
    await mark({ inboxId: id, lease: second.lease, outcome: 'released' });
    expect(
      await mark({ inboxId: id, lease: null, outcome: 'failed', errorCode: 'handler_failed' }),
    ).toEqual({ changed: true });
    expect(await claim(id)).toEqual({ claimed: false });
  });

  it('says when the claim failed a row after ten tries', async () => {
    const id = await stored();
    await asMigrator((m) => m`update webhook_inbox set attempts = 10 where id = ${id}`);
    expect(await claim(id)).toEqual({ claimed: false, failed: 'too_many_attempts' });
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

describe('webhooks.inbox.sweep', () => {
  it('is denied to every person and agent', async () => {
    for (const role of ['executive', 'general_manager', 'agent:triage'] as const) {
      const error = await refusal(
        asPrincipal(principalFor(role, [1]), (context) =>
          runCommand(sweepWebhooks, { context, audit, outbox }, {}),
        ),
      );
      expect({ role, ...error }).toEqual({ role, code: 'forbidden', stage: 'guard' });
    }
  });

  it('removes what is past its retention, records the run and answers the rows left waiting', async () => {
    const waiting = newId();
    const old = newId();
    const hash = (id: string) => createHash('sha256').update(id).digest('hex');
    await asMigrator(
      (
        m,
      ) => m`insert into webhook_inbox (id, provider, provider_event_id, payload_json, payload_sha256,
                                          received_at, processed_at)
               values (${waiting}, 'livekit', ${waiting}, '{}'::jsonb, ${hash(waiting)},
                       now() - interval '1 hour', null),
                      (${old}, 'livekit', ${old}, '{}'::jsonb, ${hash(old)},
                       now() - interval '45 days', now() - interval '44 days')`,
    );
    const swept = await asPrincipal(workers, (context) =>
      runCommand(sweepWebhooks, { context, audit, outbox }, {}),
    );
    expect(swept.payloadsRemoved).toBeGreaterThanOrEqual(1);
    expect(swept.waiting).toContainEqual({ inboxId: waiting, attempts: 0 });
    const [row] = await asMigrator(
      (m) => m<{ purged: boolean }[]>`select payload_purged_at is not null as purged
                                        from webhook_inbox where id = ${old}`,
    );
    expect(row?.purged).toBe(true);
    const [run] = await asMigrator(
      (m) => m<{ error: string | null }[]>`select error from retention_runs
                                             where job = 'webhook-inbox-purge'
                                             order by started_at desc limit 1`,
    );
    expect(run).toEqual({ error: null });
  });
});

describe('webhooks.event.replay (Process again)', () => {
  async function failed(): Promise<string> {
    const id = await stored('meta_leadgen');
    const lease = await claim(id);
    if (!lease.claimed) throw new Error('expected a lease');
    await mark({
      inboxId: id,
      lease: lease.lease,
      outcome: 'failed',
      errorCode: 'payload_unreadable',
    });
    return id;
  }

  it('is denied to anyone without integrations.dlq.replay, the workers and agents included', async () => {
    const id = await failed();
    for (const role of ['general_manager', 'accounts', 'system:workers', 'agent:triage'] as const) {
      const error = await refusal(
        asPrincipal(principalFor(role, [1]), (context) =>
          runCommand(replayWebhook, { context, audit, outbox }, { inboxId: id }),
        ),
      );
      expect({ role, ...error }).toEqual({ role, code: 'forbidden', stage: 'guard' });
    }
  });

  it('puts a failed row back once, audited under no company, and refuses a row that has not failed', async () => {
    const executive = await createTestPrincipal('executive');
    const id = await failed();
    const requestId = newId();
    const replayed = await asPrincipal(executive, (context) =>
      runCommand(
        replayWebhook,
        { context: { ...context, requestId }, audit, outbox },
        { inboxId: id },
      ),
    );
    expect(replayed).toEqual({ inboxId: id, provider: 'meta_leadgen', attempts: 1 });
    const [row] = await asMigrator(
      (m) => m<{ entity_id: number | null; before_json: unknown; after_json: unknown }[]>`
        select entity_id, before_json, after_json from audit_logs
         where request_id = ${requestId} and command = 'webhooks.event.replay'`,
    );
    expect(row).toEqual({
      entity_id: null,
      before_json: { provider: 'meta_leadgen', errorCode: 'payload_unreadable', failed: true },
      after_json: { provider: 'meta_leadgen', errorCode: null, failed: false, attempts: 1 },
    });
    expect(
      await refusal(
        asPrincipal(executive, (context) =>
          runCommand(replayWebhook, { context, audit, outbox }, { inboxId: id }),
        ),
      ),
    ).toMatchObject({ code: 'conflict' });
    // Processed once from here: one claim takes it, the next finds nothing.
    expect(await claim(id)).toMatchObject({ claimed: true, attempts: 2 });
    expect(await claim(id)).toEqual({ claimed: false });
  });
});
