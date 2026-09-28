import { DomainError, newId } from '@shakti/contracts';
import { asOutboxPublisher, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '../../src/command/define-command';
import { executeCommand } from '../../src/command/execute';
import { createLead } from '../../src/commands/crm/create-lead';
import { memoryLogger } from '../../src/ports/logger';

afterAll(closeDb);

interface EventRow {
  type: string;
  entity_id: number;
  aggregate_type: string;
  payload_json: unknown;
  published_at: Date | null;
}

/** The events stored for one aggregate, read as the publisher: the application cannot read them. */
function eventsOf(aggregateId: string): Promise<EventRow[]> {
  return asOutboxPublisher(
    (p) => p<EventRow[]>`
      select type, entity_id, aggregate_type, payload_json, published_at
        from outbox_events where aggregate_id = ${aggregateId} order by sequence`,
  );
}

/** Emits one event for the aggregate it is given, then fails when asked to. */
const emitThenMaybeFail = defineCommand({
  name: 'test.outbox.emit',
  permission: 'crm.lead.read',
  auditFields: [],
  input: z.object({ aggregateId: z.string(), fail: z.boolean() }).strict(),
  output: z.object({}).strict(),
  handler: (ctx, input) => {
    ctx.emit({
      type: 'admin.user.reactivated',
      entityId: 1,
      aggregateType: 'user',
      aggregateId: input.aggregateId,
      payload: {},
    });
    if (input.fail) throw new DomainError('conflict', 'asked to fail');
    return Promise.resolve({});
  },
});

const lead = {
  entityId: 1,
  pipelineKey: 'farmer_pumps',
  contact: { name: 'Outbox test customer', phone: '9812345670' },
  account: { type: 'farm' },
};

describe('events of a command (ADR 0005, docs/design/backend-weeks-3-5.md §4.1)', () => {
  it('are stored with the change, checked and versioned, and handed on after the commit', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const onCommitted = vi.fn();
    const created = await executeCommand(caller, { entityIds: [1] }, createLead, lead, {
      onCommitted,
    });
    expect(await eventsOf(created.id)).toEqual([
      {
        type: 'crm.lead.created',
        entity_id: 1,
        aggregate_type: 'opportunity',
        payload_json: {
          v: 1,
          pipelineKey: 'farmer_pumps',
          sourceCode: null,
          existingAccount: false,
        },
        published_at: null,
      },
    ]);
    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect(onCommitted).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'crm.lead.created', aggregateId: created.id }),
    ]);
  });

  it('are not stored, and nothing is handed on, when the command fails after emitting', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const aggregateId = newId();
    const onCommitted = vi.fn();
    await expect(
      executeCommand(
        caller,
        { entityIds: [1] },
        emitThenMaybeFail,
        { aggregateId, fail: true },
        { onCommitted, logger: memoryLogger() },
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await eventsOf(aggregateId)).toEqual([]);
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it('are not stored for a call the guard refuses', async () => {
    const inventory = await createTestPrincipal('inventory_manager', [1]);
    const aggregateId = newId();
    await expect(
      executeCommand(
        inventory,
        { entityIds: [1] },
        emitThenMaybeFail,
        { aggregateId, fail: false },
        {
          logger: memoryLogger(),
        },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await eventsOf(aggregateId)).toEqual([]);
  });

  it('keep the command committed when the hook after the commit fails', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const aggregateId = newId();
    const logger = memoryLogger();
    await expect(
      executeCommand(
        caller,
        { entityIds: [1] },
        emitThenMaybeFail,
        { aggregateId, fail: false },
        { onCommitted: () => Promise.reject(new Error('queue down')), logger },
      ),
    ).resolves.toEqual({});
    expect(await eventsOf(aggregateId)).toHaveLength(1);
    expect(logger.entries).toEqual([
      expect.objectContaining({ level: 'warn', event: 'outbox.nudge_failed' }),
      expect.objectContaining({
        event: 'command.completed',
        fields: expect.objectContaining({ outcome: 'ok' }) as unknown,
      }),
    ]);
  });

  it('skip the hook when the command stored no event', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const quiet = defineCommand({
      name: 'test.outbox.quiet',
      permission: 'crm.lead.read',
      auditFields: [],
      input: z.object({}).strict(),
      output: z.object({}).strict(),
      handler: () => Promise.resolve({}),
    });
    const onCommitted = vi.fn();
    await executeCommand(caller, { entityIds: [1] }, quiet, {}, { onCommitted });
    expect(onCommitted).not.toHaveBeenCalled();
  });
});
