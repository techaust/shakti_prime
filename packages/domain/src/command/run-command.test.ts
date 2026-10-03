import { DomainError, newId } from '@shakti/contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineCommand } from './define-command';
import { memoryAuditSink } from '../audit/sink';
import { memoryIdempotencyStore } from '../idempotency/store';
import { memoryOutboxSink } from '../outbox/sink';
import type { ExecuteOptions } from './execute';
import {
  checkPermission,
  failureOf,
  runCommand,
  translateDatabaseError,
  undeclaredAuditFields,
  type RunOptions,
} from './run-command';
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
  auditFields: [],
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
      runCommand(
        echo,
        { context: context(principal()), audit: memoryAuditSink(), outbox: memoryOutboxSink() },
        { value: 1 },
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('denies before the handler runs, writes nothing and marks the guard stage', async () => {
    const audit = memoryAuditSink();
    const p = principal({ permissions: [] });
    const error: unknown = await runCommand(
      echo,
      { context: context(p), audit, outbox: memoryOutboxSink() },
      { value: 'x' },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'forbidden' });
    expect(failureOf(error)).toEqual({ stage: 'guard', input: { value: 'x' } });
    expect(audit.records).toEqual([]);
  });

  it('marks input that does not parse, so nothing is recorded for it', async () => {
    const error: unknown = await runCommand(
      echo,
      { context: context(principal()), audit: memoryAuditSink(), outbox: memoryOutboxSink() },
      { value: 1 },
    ).catch((e: unknown) => e);
    expect(failureOf(error)?.stage).toBe('input');
  });

  it('marks a handler failure with the parsed input', async () => {
    const failing = defineCommand({
      name: 'test.failing',
      permission: 'crm.lead.read',
      auditFields: [],
      input: z.object({ value: z.string() }).strict(),
      output: z.object({}).strict(),
      handler: () => Promise.reject(new DomainError('conflict', 'taken', { reason: 'x' })),
    });
    const audit = memoryAuditSink();
    const error: unknown = await runCommand(
      failing,
      { context: context(principal()), audit, outbox: memoryOutboxSink() },
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
      auditFields: ['status', 'email', 'token', 'n'],
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
      {
        context: ctx,
        audit,
        outbox: memoryOutboxSink(),
        client: { ip: '203.0.113.9', device: 'Chrome' },
      },
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
      { context: context(principal({ entityIds: [1, 2] })), audit, outbox: memoryOutboxSink() },
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

  it('returns the DTO, audits the call and stores emitted events with their version', async () => {
    const audit = memoryAuditSink();
    const outbox = memoryOutboxSink();
    const emitting = defineCommand({
      name: 'test.emit',
      permission: 'crm.lead.read',
      auditFields: [],
      input: z.object({}).strict(),
      output: z.object({ ok: z.literal(true) }).strict(),
      handler: (ctx) => {
        ctx.emit({
          type: 'admin.user.reactivated',
          entityId: 1,
          aggregateType: 'user',
          aggregateId: 'a',
          payload: {},
        });
        return Promise.resolve({ ok: true as const });
      },
    });
    const p = principal();
    const ctx = context(p);
    const result = await runCommand(emitting, { context: ctx, audit, outbox }, {});
    expect(result).toEqual({ ok: true });
    expect(audit.records).toEqual([
      expect.objectContaining({
        command: 'test.emit',
        actorPrincipalId: p.id,
        requestId: ctx.requestId,
      }),
    ]);
    expect(outbox.records).toEqual([
      {
        type: 'admin.user.reactivated',
        entityId: 1,
        aggregateType: 'user',
        aggregateId: 'a',
        payload: { v: 1 },
      },
    ]);
  });

  it('hands the outbox sink the command transaction', async () => {
    const write = vi.fn(() => Promise.resolve());
    const ctx = context(principal());
    await runCommand(
      echo,
      { context: ctx, audit: memoryAuditSink(), outbox: { write } },
      { value: 'x' },
    );
    expect(write).toHaveBeenCalledWith(ctx.tx, []);
  });

  it.each([
    ['a type outside the catalogue', 'test.happened', {}],
    ['a payload that does not fit its type', 'admin.user.suspended', { reason: 'left' }],
  ])('fails the command that emits %s', async (_label, type, payload) => {
    const outbox = memoryOutboxSink();
    const bad = defineCommand({
      name: 'test.bad_event',
      permission: 'crm.lead.read',
      auditFields: [],
      input: z.object({}).strict(),
      output: z.object({}).strict(),
      handler: (ctx) => {
        ctx.emit({ type, entityId: 1, aggregateType: 'user', aggregateId: 'a', payload });
        return Promise.resolve({});
      },
    });
    const error: unknown = await runCommand(
      bad,
      { context: context(principal()), audit: memoryAuditSink(), outbox },
      {},
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'internal', details: { eventType: type } });
    expect(failureOf(error)?.stage).toBe('handler');
    expect(outbox.records).toEqual([]);
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
      auditFields: [],
      minScope: 'entity',
      input: z.object({}).strict(),
      output: z.object({}).strict(),
      handler: () => Promise.resolve({}),
    });
    const own = principal({ permissions: [{ key: 'crm.lead.read', scope: 'own' }] });
    await expect(
      runCommand(
        entityWide,
        { context: context(own), audit: memoryAuditSink(), outbox: memoryOutboxSink() },
        {},
      ),
    ).rejects.toMatchObject({
      code: 'forbidden',
      details: { permission: 'crm.lead.read', scope: 'entity' },
    });
    const all = principal({ permissions: [{ key: 'crm.lead.read', scope: 'all' }] });
    await expect(
      runCommand(
        entityWide,
        { context: context(all), audit: memoryAuditSink(), outbox: memoryOutboxSink() },
        {},
      ),
    ).resolves.toEqual({});
  });

  it('translates a failing audit or outbox write like a handler failure', async () => {
    const cmd = defineCommand({
      name: 'test.sink',
      permission: 'crm.lead.read',
      auditFields: [],
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
      { context: context(principal()), audit, outbox: memoryOutboxSink() },
      {},
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'conflict', details: { reason: 'concurrent_change' } });
    expect(failureOf(error)?.stage).toBe('handler');
  });

  it('translates a failing outbox write like a handler failure', async () => {
    const outbox = {
      write: () => Promise.reject(Object.assign(new Error('permission denied'), { code: '42501' })),
    };
    const error: unknown = await runCommand(
      echo,
      { context: context(principal()), audit: memoryAuditSink(), outbox },
      { value: 'x' },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'forbidden' });
    expect(failureOf(error)?.stage).toBe('handler');
  });

  it('refuses data outside the declared DTO instead of leaking it', async () => {
    const leaky = defineCommand({
      name: 'test.leaky',
      permission: 'crm.lead.read',
      auditFields: [],
      input: z.object({}).strict(),
      output: z.object({ name: z.string() }).strict(),
      handler: () => Promise.resolve({ name: 'x', movingAvgCost: '123.00' } as { name: string }),
    });
    await expect(
      runCommand(
        leaky,
        { context: context(principal()), audit: memoryAuditSink(), outbox: memoryOutboxSink() },
        {},
      ),
    ).rejects.toMatchObject({
      code: 'internal',
    });
  });

  it('sets activeEntityId only for a single-entity scope', async () => {
    const probe = defineCommand({
      name: 'test.probe',
      permission: 'crm.lead.read',
      auditFields: [],
      input: z.object({}).strict(),
      output: z.object({ active: z.number().nullable() }).strict(),
      handler: (ctx) => Promise.resolve({ active: ctx.activeEntityId ?? null }),
    });
    const single = await runCommand(
      probe,
      {
        context: context(principal({ entityIds: [3] })),
        audit: memoryAuditSink(),
        outbox: memoryOutboxSink(),
      },
      {},
    );
    const many = await runCommand(
      probe,
      {
        context: context(principal({ entityIds: [1, 2] })),
        audit: memoryAuditSink(),
        outbox: memoryOutboxSink(),
      },
      {},
    );
    expect(single.active).toBe(3);
    expect(many.active).toBeNull();
  });
});

describe('runCommand with an idempotency key', () => {
  let runs = 0;
  const counted = defineCommand({
    name: 'test.counted',
    permission: 'crm.lead.read',
    auditFields: [],
    input: z.object({ value: z.string() }).strict(),
    output: z.object({ value: z.string(), run: z.number() }).strict(),
    handler: (ctx, input) => {
      runs += 1;
      ctx.emit({
        type: 'admin.user.reactivated',
        entityId: 1,
        aggregateType: 'user',
        aggregateId: 'a',
        payload: {},
      });
      return Promise.resolve({ value: input.value, run: runs });
    },
  });

  function run(
    options: { key?: string; principal?: Principal; value?: string } = {},
    idempotency = memoryIdempotencyStore(),
  ) {
    const audit = memoryAuditSink();
    const outbox = memoryOutboxSink();
    const call = runCommand(
      counted,
      {
        context: context(options.principal ?? principal()),
        audit,
        outbox,
        idempotency,
        ...(options.key === undefined ? {} : { idempotencyKey: options.key }),
      },
      { value: options.value ?? 'x' },
    );
    return { call, audit, outbox };
  }

  it('runs once and replays the first answer, with no second audit row or event', async () => {
    const store = memoryIdempotencyStore();
    const p = principal();
    const first = run({ key: 'k1', principal: p }, store);
    const answer = await first.call;
    const repeat = run({ key: 'k1', principal: p }, store);
    expect(await repeat.call).toEqual(answer);
    expect(first.audit.records).toHaveLength(1);
    expect(first.outbox.records).toHaveLength(1);
    expect(repeat.audit.records).toEqual([]);
    expect(repeat.outbox.records).toEqual([]);
    const rows = [...store.rows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ command: 'test.counted', response: answer });
    expect(rows[0]?.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses the same key with other input', async () => {
    const store = memoryIdempotencyStore();
    const p = principal();
    await run({ key: 'k2', principal: p, value: 'x' }, store).call;
    const error: unknown = await run({ key: 'k2', principal: p, value: 'y' }, store).call.catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'conflict', details: { reason: 'idempotency_mismatch' } });
    expect(failureOf(error)?.stage).toBe('handler');
  });

  it('checks the permission before it looks at the key', async () => {
    const store = memoryIdempotencyStore();
    const p = principal();
    await run({ key: 'k3', principal: p }, store).call;
    const denied = run({ key: 'k3', principal: { ...p, permissions: [] } }, store);
    await expect(denied.call).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('runs every call without a key', async () => {
    const store = memoryIdempotencyStore();
    const p = principal();
    const a = await run({ principal: p }, store).call;
    const b = await run({ principal: p }, store).call;
    expect(b.run).toBe(a.run + 1);
    expect(store.rows.size).toBe(0);
  });
});

describe('commands inside commands and audit summaries', () => {
  const outer = defineCommand({
    name: 'test.outer',
    permission: 'crm.lead.read',
    auditFields: [],
    input: z.object({ values: z.array(z.string()), failAt: z.number().optional() }).strict(),
    output: z.object({ count: z.number() }).strict(),
    auditInput: (input) => ({ values: input.values.length }),
    async handler(ctx, input) {
      for (const [i, value] of input.values.entries()) {
        await ctx.run(echo, i === input.failAt ? { value: i } : { value }, {
          idempotencyKey: newId(),
        });
      }
      return { count: input.values.length };
    },
  });

  it('runs the inner command with its own guard, audit row and key, in the same sinks', async () => {
    const audit = memoryAuditSink();
    const store = memoryIdempotencyStore();
    const result = await runCommand(
      outer,
      { context: context(principal()), audit, outbox: memoryOutboxSink(), idempotency: store },
      { values: ['a', 'b'] },
    );
    expect(result).toEqual({ count: 2 });
    expect(audit.records.map((r) => r.command)).toEqual(['test.echo', 'test.echo', 'test.outer']);
    expect(store.rows.size).toBe(2);
    // The outer row records the summary, never the values themselves.
    expect(audit.records[2]?.input).toEqual({ values: 2 });
    expect(audit.records[0]?.input).toEqual({ value: 'a' });
  });

  it('tags an inner failure with the outer command’s stage and input', async () => {
    const error: unknown = await runCommand(
      outer,
      {
        context: context(principal()),
        audit: memoryAuditSink(),
        outbox: memoryOutboxSink(),
        idempotency: memoryIdempotencyStore(),
      },
      { values: ['a', 'b'], failAt: 1 },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'validation_failed' });
    expect(failureOf(error)).toEqual({
      stage: 'handler',
      input: { values: ['a', 'b'], failAt: 1 },
    });
  });

  it('refuses the inner command when the caller lacks its permission', async () => {
    const guarded = defineCommand({
      ...outer,
      name: 'test.outer_guarded',
      permission: 'crm.lead.read',
      async handler(ctx) {
        await ctx.run({ ...echo, permission: 'finance.cost.read' }, { value: 'x' });
        return { count: 0 };
      },
    });
    await expect(
      runCommand(
        guarded,
        { context: context(principal()), audit: memoryAuditSink(), outbox: memoryOutboxSink() },
        { values: [] },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('savepoints and summarised inner commands', () => {
  const noisy = defineCommand({
    name: 'test.noisy',
    permission: 'crm.lead.read',
    auditFields: ['value'],
    input: z.object({ value: z.string(), fail: z.boolean().default(false) }).strict(),
    output: z.object({ value: z.string() }).strict(),
    handler: (ctx, input) => {
      const id = newId();
      ctx.audit({ aggregateType: 'thing', aggregateId: id, after: { value: input.value } });
      ctx.emit({
        type: 'admin.user.reactivated',
        entityId: 1,
        aggregateType: 'user',
        aggregateId: id,
        payload: {},
      });
      if (input.fail) return Promise.reject(new DomainError('conflict', 'raced'));
      return Promise.resolve({ value: input.value });
    },
  });

  const batches = defineCommand({
    name: 'test.batches',
    permission: 'crm.lead.read',
    auditFields: [],
    input: z.object({ summarised: z.boolean() }).strict(),
    output: z.object({ failed: z.number() }).strict(),
    async handler(ctx, input) {
      let failed = 0;
      for (const fail of [false, true]) {
        try {
          await ctx.savepoint(async (sp) => {
            const options = { tx: sp, auditedByCaller: input.summarised };
            await ctx.run(noisy, { value: 'a' }, options);
            await ctx.run(noisy, { value: 'b', fail }, options);
          });
        } catch {
          failed += 1;
        }
      }
      return { failed };
    },
  });

  /** A context whose transaction opens savepoints that do nothing, as a pure test needs. */
  function savepointContext() {
    const base = context(principal());
    const tx = { transaction: (work: (sp: unknown) => Promise<unknown>) => work(tx) };
    return { ...base, tx: tx as unknown as typeof base.tx };
  }

  it('drops what a rolled-back savepoint recorded, and keeps what a committed one did', async () => {
    const audit = memoryAuditSink();
    const outbox = memoryOutboxSink();
    const result = await runCommand(
      batches,
      { context: savepointContext(), audit, outbox },
      { summarised: false },
    );
    expect(result).toEqual({ failed: 1 });
    // The first savepoint's two inner calls, then the outer call's own row.
    expect(audit.records.map((r) => r.command)).toEqual([
      'test.noisy',
      'test.noisy',
      'test.batches',
    ]);
    expect(outbox.records).toHaveLength(2);
  });

  it('writes no row for an inner command its caller summarises, but keeps its events', async () => {
    const audit = memoryAuditSink();
    const outbox = memoryOutboxSink();
    await runCommand(batches, { context: savepointContext(), audit, outbox }, { summarised: true });
    expect(audit.records.map((r) => r.command)).toEqual(['test.batches']);
    expect(outbox.records.map((r) => r.type)).toEqual([
      'admin.user.reactivated',
      'admin.user.reactivated',
    ]);
  });
});

describe('declared audit fields', () => {
  it('names the keys of a change a command does not declare, ids aside', () => {
    expect(
      undeclaredAuditFields(['status'], {
        before: { status: 'open', ownerId: 'x' },
        after: { status: 'closed', lockedUntil: null, entityIds: [1], id: 'y' },
      }),
    ).toEqual(['lockedUntil']);
    expect(undeclaredAuditFields([], { before: null })).toEqual([]);
  });

  it('refuses a command that records a field it does not declare, before anything is written', async () => {
    const audit = memoryAuditSink();
    const quiet = defineCommand({
      name: 'test.quiet',
      permission: 'crm.lead.read',
      auditFields: ['status'],
      input: z.object({}).strict(),
      output: z.object({}).strict(),
      handler: (ctx) => {
        ctx.audit({
          aggregateType: 'thing',
          aggregateId: 'a',
          after: { status: 'x', colour: 'y' },
        });
        return Promise.resolve({});
      },
    });
    await expect(
      runCommand(quiet, { context: context(principal()), audit, outbox: memoryOutboxSink() }, {}),
    ).rejects.toMatchObject({ code: 'internal', details: { fields: ['colour'] } });
    expect(audit.records).toEqual([]);
  });
});

describe('inImportBatch is set only by an import batch through ctx.run', () => {
  const probe = defineCommand({
    name: 'test.probe_batch',
    permission: 'crm.lead.read',
    auditFields: [],
    input: z.object({}).strict(),
    output: z.object({ inBatch: z.boolean() }).strict(),
    handler: (ctx) => Promise.resolve({ inBatch: ctx.inImportBatch === true }),
  });
  const caller = defineCommand({
    name: 'test.probe_caller',
    permission: 'crm.lead.read',
    auditFields: [],
    input: z.object({ batch: z.boolean() }).strict(),
    output: z.object({ inBatch: z.boolean() }).strict(),
    handler: (ctx, input) =>
      ctx.run(probe, {}, input.batch ? { inImportBatch: true, auditedByCaller: true } : {}),
  });
  const sinks = () => ({ audit: memoryAuditSink(), outbox: memoryOutboxSink() });

  it('is true for a command an import batch runs, and false for any other nested run', async () => {
    const run = (batch: boolean) =>
      runCommand(caller, { context: context(principal()), ...sinks() }, { batch });
    await expect(run(true)).resolves.toEqual({ inBatch: true });
    await expect(run(false)).resolves.toEqual({ inBatch: false });
  });

  it('cannot be set through the options of runCommand or executeCommand', async () => {
    // @ts-expect-error: executeCommand's options have no inImportBatch.
    const refused: ExecuteOptions = { inImportBatch: true };
    const smuggled = { context: context(principal()), ...sinks(), ...refused } as RunOptions;
    await expect(runCommand(probe, smuggled, {})).resolves.toEqual({ inBatch: false });
  });
});

describe('a permission named by the input', () => {
  const byKind = defineCommand({
    name: 'test.by_kind',
    permission: {
      keys: ['crm.lead.read', 'admin.entities.write'],
      of: ({ kind }: { kind: string }) =>
        kind === 'lead'
          ? { permission: 'crm.lead.read', minScope: 'own' }
          : kind === 'logo'
            ? { permission: 'admin.entities.write', minScope: 'all' }
            : null,
    },
    auditFields: [],
    input: z.object({ kind: z.string() }).strict(),
    output: z.object({ kind: z.string() }).strict(),
    handler: (_ctx, input) => Promise.resolve({ kind: input.kind }),
  });
  const run = (p: Principal, kind: string) =>
    runCommand(
      byKind,
      { context: context(p), audit: memoryAuditSink(), outbox: memoryOutboxSink() },
      { kind },
    );

  it('checks the permission the input names', async () => {
    await expect(run(principal(), 'lead')).resolves.toEqual({ kind: 'lead' });
    const refused: unknown = await run(principal(), 'logo').catch((e: unknown) => e);
    expect(refused).toMatchObject({ code: 'forbidden' });
    expect(failureOf(refused)?.stage).toBe('guard');
  });

  it('checks the scope it names', async () => {
    const entityOnly = principal({
      permissions: [{ key: 'admin.entities.write', scope: 'entity' }],
    });
    await expect(run(entityOnly, 'logo')).rejects.toMatchObject({ code: 'forbidden' });
    const all = principal({ permissions: [{ key: 'admin.entities.write', scope: 'all' }] });
    await expect(run(all, 'logo')).resolves.toEqual({ kind: 'logo' });
  });

  it('refuses an input no request may send, whatever the caller holds', async () => {
    const everything = principal({
      permissions: [
        { key: 'crm.lead.read', scope: 'all' },
        { key: 'admin.entities.write', scope: 'all' },
      ],
    });
    await expect(run(everything, 'vault')).rejects.toMatchObject({ code: 'forbidden' });
  });
});
