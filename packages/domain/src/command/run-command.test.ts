import { newId } from '@shakti/contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './define-command';
import { checkPermission, runCommand } from './run-command';
import { fakeContext as context, type Principal } from './test-support';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: newId(),
    kind: 'user',
    roleKey: 'general_manager',
    entityIds: [1],
    permissions: [{ key: 'crm.lead.read', scope: 'entity' }],
    locale: 'en',
    ...overrides,
  };
}

const echo = defineCommand({
  name: 'test.echo',
  permission: 'crm.lead.read',
  input: z.object({ value: z.string() }).strict(),
  output: z.object({ value: z.string() }).strict(),
  handler: (_ctx, input) => Promise.resolve({ value: input.value }),
});

describe('checkPermission', () => {
  it('passes when the grant is at least as wide as the required scope', () => {
    expect(() => {
      checkPermission(principal(), 'crm.lead.read', 'own');
    }).not.toThrow();
    expect(() => {
      checkPermission(principal(), 'crm.lead.read', 'entity');
    }).not.toThrow();
  });

  it('denies a narrower grant or a missing permission', () => {
    expect(() => {
      checkPermission(principal(), 'crm.lead.read', 'all');
    }).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(() => {
      checkPermission(principal(), 'finance.cost.read');
    }).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });
});

describe('runCommand', () => {
  it('validates input before anything else', async () => {
    await expect(
      runCommand(echo, { context: context(principal()) }, { value: 1 }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('denies before the handler runs and audits nothing', async () => {
    const onAudit = vi.fn();
    const p = principal({ permissions: [] });
    await expect(
      runCommand(echo, { context: context(p), onAudit }, { value: 'x' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(onAudit).not.toHaveBeenCalled();
  });

  it('returns the DTO, audits the call and forwards emitted events', async () => {
    const onAudit = vi.fn();
    const onEmit = vi.fn();
    const emitting = defineCommand({
      name: 'test.emit',
      permission: 'crm.lead.read',
      input: z.object({}).strict(),
      output: z.object({ ok: z.literal(true) }).strict(),
      handler: (ctx) => {
        ctx.emit({
          type: 'test.happened',
          entityId: 1,
          aggregateType: 'test',
          aggregateId: 'a',
          payload: {},
        });
        return Promise.resolve({ ok: true as const });
      },
    });
    const p = principal();
    const ctx = context(p);
    const result = await runCommand(emitting, { context: ctx, onAudit, onEmit }, {});
    expect(result).toEqual({ ok: true });
    expect(onAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'test.emit',
        principalId: p.id,
        requestId: ctx.requestId,
      }),
    );
    expect(onEmit).toHaveBeenCalledWith([expect.objectContaining({ type: 'test.happened' })]);
  });

  it('refuses data outside the declared DTO instead of leaking it', async () => {
    const leaky = defineCommand({
      name: 'test.leaky',
      permission: 'crm.lead.read',
      input: z.object({}).strict(),
      output: z.object({ name: z.string() }).strict(),
      handler: () => Promise.resolve({ name: 'x', movingAvgCost: '123.00' } as { name: string }),
    });
    await expect(runCommand(leaky, { context: context(principal()) }, {})).rejects.toMatchObject({
      code: 'internal',
    });
  });

  it('sets activeEntityId only for a single-entity scope', async () => {
    const probe = defineCommand({
      name: 'test.probe',
      permission: 'crm.lead.read',
      input: z.object({}).strict(),
      output: z.object({ active: z.number().nullable() }).strict(),
      handler: (ctx) => Promise.resolve({ active: ctx.activeEntityId ?? null }),
    });
    const single = await runCommand(probe, { context: context(principal({ entityIds: [3] })) }, {});
    const many = await runCommand(
      probe,
      { context: context(principal({ entityIds: [1, 2] })) },
      {},
    );
    expect(single.active).toBe(3);
    expect(many.active).toBeNull();
  });
});
