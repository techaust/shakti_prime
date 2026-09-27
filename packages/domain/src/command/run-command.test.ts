import { DomainError, newId } from '@shakti/contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './define-command';
import { memoryAuditSink } from '../audit/sink';
import { checkPermission, failureOf, runCommand, translateDatabaseError } from './run-command';
import { fakeContext as context, type Principal } from './test-support';

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    id: newId(),
    kind: 'user',
    roleKey: 'general_manager',
    entityIds: [1],
    permissions: [{ key: 'crm.lead.read', scope: 'entity' }],
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
      runCommand(echo, { context: context(principal()), audit: memoryAuditSink() }, { value: 1 }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('denies before the handler runs, writes nothing and marks the guard stage', async () => {
    const audit = memoryAuditSink();
    const p = principal({ permissions: [] });
    const error: unknown = await runCommand(
      echo,
      { context: context(p), audit },
      { value: 'x' },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'forbidden' });
    expect(failureOf(error)).toEqual({ stage: 'guard', input: { value: 'x' } });
    expect(audit.records).toEqual([]);
  });

  it('marks input that does not parse, so nothing is recorded for it', async () => {
    const error: unknown = await runCommand(
      echo,
      { context: context(principal()), audit: memoryAuditSink() },
      { value: 1 },
    ).catch((e: unknown) => e);
    expect(failureOf(error)?.stage).toBe('input');
  });

  it('marks a handler failure with the parsed input', async () => {
    const failing = defineCommand({
      name: 'test.failing',
      permission: 'crm.lead.read',
      input: z.object({ value: z.string() }).strict(),
      output: z.object({}).strict(),
      handler: () => Promise.reject(new DomainError('conflict', 'taken', { reason: 'x' })),
    });
    const audit = memoryAuditSink();
    const error: unknown = await runCommand(
      failing,
      { context: context(principal()), audit },
      { value: 'y' },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'conflict' });
    expect(failureOf(error)).toEqual({ stage: 'handler', input: { value: 'y' } });
    expect(audit.records).toEqual([]);
  });

  it('writes one redacted row per changed aggregate, with the caller and the request', async () => {
    const changing = defineCommand({
      name: 'test.change',
      permission: 'crm.lead.read',
      input: z.object({ phone: z.string(), password: z.string() }).strict(),
      output: z.object({}).strict(),
      handler: (ctx) => {
        ctx.audit({
          aggregateType: 'thing',
          aggregateId: 'a',
          before: { status: 'open', token: 'x' },
          after: { status: 'closed', email: 'owner@shaktisupreme.in' },
        });
        ctx.audit({ aggregateType: 'shared', aggregateId: 'b', entityId: null, after: { n: 1 } });
        return Promise.resolve({});
      },
    });
    const audit = memoryAuditSink();
    const p = principal({ entityIds: [2] });
    const ctx = context(p);
    await runCommand(
      changing,
      { context: ctx, audit, client: { ip: '203.0.113.9', device: 'Chrome' } },
      { phone: '+919876543210', password: 'Hunter2hunter2' },
    );
    expect(audit.records).toEqual([
      {
        command: 'test.change',
        outcome: 'ok',
        entityId: 2,
        actorPrincipalId: p.id,
        actorKind: 'user',
        onBehalfOfUserId: null,
        aggregateType: 'thing',
        aggregateId: 'a',
        errorCode: null,
        input: { phone: '********3210' },
        before: { status: 'open' },
        after: { status: 'closed', email: '********e.in' },
        client: { ip: '203.0.113.9', device: 'Chrome' },
        requestId: ctx.requestId,
      },
      expect.objectContaining({ aggregateType: 'shared', entityId: null, before: null }),
    ]);
  });

  it('writes one row for the call when the handler names no aggregate', async () => {
    const audit = memoryAuditSink();
    await runCommand(
      echo,
      { context: context(principal({ entityIds: [1, 2] })), audit },
      { value: 'x' },
    );
    expect(audit.records).toEqual([
      expect.objectContaining({
        command: 'test.echo',
        entityId: null,
        aggregateType: null,
        aggregateId: null,
        input: { value: 'x' },
      }),
    ]);
  });

  it('returns the DTO, audits the call and forwards emitted events', async () => {
    const audit = memoryAuditSink();
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
    const result = await runCommand(emitting, { context: ctx, audit, onEmit }, {});
    expect(result).toEqual({ ok: true });
    expect(audit.records).toEqual([
      expect.objectContaining({
        command: 'test.emit',
        actorPrincipalId: p.id,
        requestId: ctx.requestId,
      }),
    ]);
    expect(onEmit).toHaveBeenCalledWith([expect.objectContaining({ type: 'test.happened' })]);
  });

  it('names a catalogue reason for a constraint the command declares', () => {
    const pg = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint_name: 'users_email_unique',
    });
    const wrapped = new Error('query failed', { cause: pg });
    const named = translateDatabaseError(wrapped, 'admin.user.invite', {
      users_email_unique: 'invite_email_taken',
    });
    expect(named).toMatchObject({ code: 'conflict', details: { reason: 'invite_email_taken' } });
    const plain = translateDatabaseError(wrapped, 'admin.user.invite');
    expect(plain).toMatchObject({ code: 'conflict', details: { reason: 'concurrent_change' } });
  });

  it('keeps the original failure as the cause, and leaves driver errors untranslated (AUDIT M30, M35)', () => {
    const pg = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    const translated = translateDatabaseError(pg, 'test.cmd');
    expect(translated).toMatchObject({ code: 'conflict', cause: pg });
    const refused = translateDatabaseError(
      Object.assign(new Error('new row violates row-level security policy'), { code: '42501' }),
      'test.cmd',
    );
    expect(refused).toMatchObject({ code: 'forbidden', details: { sqlstate: '42501' } });
    expect((refused as { details?: { reason?: unknown } }).details?.reason).toBeUndefined();
    const network = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(translateDatabaseError(network, 'test.cmd')).toBe(network);
  });

  it('holds a command to its minScope: a narrower grant of the same permission is refused (AUDIT M41)', async () => {
    const entityWide = defineCommand({
      name: 'test.entity_wide',
      permission: 'crm.lead.read',
      minScope: 'entity',
      input: z.object({}).strict(),
      output: z.object({}).strict(),
      handler: () => Promise.resolve({}),
    });
    const own = principal({ permissions: [{ key: 'crm.lead.read', scope: 'own' }] });
    await expect(
      runCommand(entityWide, { context: context(own), audit: memoryAuditSink() }, {}),
    ).rejects.toMatchObject({
      code: 'forbidden',
      details: { permission: 'crm.lead.read', scope: 'entity' },
    });
    const all = principal({ permissions: [{ key: 'crm.lead.read', scope: 'all' }] });
    await expect(
      runCommand(entityWide, { context: context(all), audit: memoryAuditSink() }, {}),
    ).resolves.toEqual({});
  });

  it('translates a failing audit or outbox write like a handler failure', async () => {
    const cmd = defineCommand({
      name: 'test.sink',
      permission: 'crm.lead.read',
      input: z.object({}).strict(),
      output: z.object({}).strict(),
      handler: () => Promise.resolve({}),
    });
    const audit = {
      write: () =>
        Promise.reject(Object.assign(new Error('could not serialize access'), { code: '40001' })),
    };
    const error: unknown = await runCommand(
      cmd,
      { context: context(principal()), audit },
      {},
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'conflict', details: { reason: 'concurrent_change' } });
    expect(failureOf(error)?.stage).toBe('handler');
  });

  it('refuses data outside the declared DTO instead of leaking it', async () => {
    const leaky = defineCommand({
      name: 'test.leaky',
      permission: 'crm.lead.read',
      input: z.object({}).strict(),
      output: z.object({ name: z.string() }).strict(),
      handler: () => Promise.resolve({ name: 'x', movingAvgCost: '123.00' } as { name: string }),
    });
    await expect(
      runCommand(leaky, { context: context(principal()), audit: memoryAuditSink() }, {}),
    ).rejects.toMatchObject({
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
    const single = await runCommand(
      probe,
      { context: context(principal({ entityIds: [3] })), audit: memoryAuditSink() },
      {},
    );
    const many = await runCommand(
      probe,
      { context: context(principal({ entityIds: [1, 2] })), audit: memoryAuditSink() },
      {},
    );
    expect(single.active).toBe(3);
    expect(many.active).toBeNull();
  });
});
