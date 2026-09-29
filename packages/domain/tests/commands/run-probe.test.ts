import { DeliveryProbeDto } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { withRequestContext } from '@shakti/db';
import { afterAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { failureOf, runCommand } from '../../src/command/run-command';
import { runDeliveryProbe } from '../../src/commands/platform/run-probe';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

afterAll(async () => {
  // The suites never run the publisher; these events are marked delivered so readiness stays ok.
  await asMigrator(
    (m) => m`update outbox_events set published_at = now()
              where aggregate_type = 'delivery_probe' and published_at is null
                and dead_lettered_at is null`,
  );
  await closeDb();
});

async function eventsOf(probeId: string) {
  return asOutboxPublisher(
    (p) => p<{ type: string; entity: number; payload: Record<string, unknown> }[]>`
      select type, entity_id as entity, payload_json as payload
        from outbox_events where aggregate_type = 'delivery_probe' and aggregate_id = ${probeId}`,
  );
}

describe('platform.probe.run (the delivery check, docs/design/phase1.md §5.2)', () => {
  it('is denied without admin.integrations.write at scope all, and emits nothing', async () => {
    for (const role of [
      'general_manager',
      'accounts',
      'sales_team_lead',
      'agent:chief',
      'system:workers',
    ] as const) {
      // principalFor, not createTestPrincipal: an agent principals row would change the agent
      // count the fail-closed suite checks, and the guard refuses before anything is written.
      const principal = principalFor(role, [1]);
      const error: unknown = await asPrincipal(principal, (context) =>
        runCommand(runDeliveryProbe, { context, audit, outbox }, {}),
      ).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect({ role, error }).toMatchObject({ role, error: { code: 'forbidden' } });
      expect({ role, stage: failureOf(error)?.stage }).toEqual({ role, stage: 'guard' });
    }
  });

  it('cannot be run for a company outside the caller’s', async () => {
    const executive = await createTestPrincipal('executive', [1]);
    await expect(
      withRequestContext(executive, { entityIds: [2] }, (context) =>
        runCommand(runDeliveryProbe, { context, audit, outbox }, {}),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses any input', async () => {
    const executive = await createTestPrincipal('executive');
    await expect(
      asPrincipal(executive, (context) =>
        runCommand(runDeliveryProbe, { context, audit, outbox }, { probeId: 'mine' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('emits platform.probe.requested with the moment it ran, and audits it under no company', async () => {
    const executive = await createTestPrincipal('executive');
    const before = Date.now();
    const probe = await withRequestContext(executive, { entityIds: [3] }, (context) =>
      runCommand(runDeliveryProbe, { context, audit, outbox }, {}),
    );
    expect(DeliveryProbeDto.parse(probe)).toEqual(probe);
    expect(Date.parse(probe.requestedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(await eventsOf(probe.probeId)).toEqual([
      {
        type: 'platform.probe.requested',
        entity: 3,
        payload: { v: 1, requestedAt: probe.requestedAt },
      },
    ]);
    const rows = await asMigrator(
      (m) => m<{ entity: number | null; outcome: string; after: unknown; actor: string }[]>`
        select entity_id as entity, outcome, after_json as after,
               actor_principal_id::text as actor
          from audit_logs
         where command = 'platform.probe.run' and aggregate_id = ${probe.probeId}`,
    );
    expect(rows).toEqual([
      {
        entity: null,
        outcome: 'ok',
        after: { requestedAt: probe.requestedAt },
        actor: executive.id,
      },
    ]);
  });

  it('files the event under the first company of a request for the whole group', async () => {
    const executive = await createTestPrincipal('executive', [4, 2, 3]);
    const probe = await asPrincipal(executive, (context) =>
      runCommand(runDeliveryProbe, { context, audit, outbox }, {}),
    );
    expect((await eventsOf(probe.probeId)).map((e) => e.entity)).toEqual([2]);
  });
});
