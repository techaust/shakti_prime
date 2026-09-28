// The timing line of executeCommand and executeQuery, with the request context, the audit sink
// and the outbox sink replaced by in-memory ones, so no database is needed. The commands' own
// behaviour on real Postgres is covered by the security suite under tests/.
import { newId, type Principal } from '@shakti/contracts';
import type * as DbModule from '@shakti/db';
import type { RequestContext, RequestScope } from '@shakti/db';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type * as AuditSinkModule from '../audit/sink';
import type * as OutboxSinkModule from '../outbox/sink';
import { memoryLogger } from '../ports/logger';
import { defineCommand } from './define-command';
import { executeCommand, executeQuery } from './execute';
import type { Clock } from './timing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const audited = vi.hoisted(() => ({ rows: [] as unknown[], statements: [] as unknown[] }));

vi.mock('@shakti/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  withRequestContext: <T>(
    principal: Principal,
    scope: RequestScope,
    fn: (context: RequestContext) => Promise<T>,
  ): Promise<T> =>
    fn({
      principal,
      entityIds: scope.entityIds ?? principal.entityIds,
      requestId: scope.requestId ?? 'generated',
      // The statements a call runs on the transaction itself, in order.
      tx: {
        execute: (statement: unknown) => {
          audited.statements.push(statement);
          return Promise.resolve([]);
        },
      } as unknown as RequestContext['tx'],
    }),
}));

vi.mock('../audit/sink', async (importOriginal) => ({
  ...(await importOriginal<typeof AuditSinkModule>()),
  databaseAuditSink: {
    write: (_tx: unknown, records: readonly unknown[]) => {
      audited.rows.push(...records);
      return Promise.resolve();
    },
  },
}));

vi.mock('../outbox/sink', async (importOriginal) => ({
  ...(await importOriginal<typeof OutboxSinkModule>()),
  databaseOutboxSink: { write: () => Promise.resolve() },
}));

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

function fakeClock(...readings: number[]): Clock {
  let i = 0;
  return () => readings[Math.min(i++, readings.length - 1)] ?? 0;
}

const echo = defineCommand({
  name: 'test.echo',
  permission: 'crm.lead.read',
  auditFields: [],
  input: z.object({ phone: z.string() }).strict(),
  output: z.object({ ok: z.boolean() }).strict(),
  handler: () => Promise.resolve({ ok: true }),
});

describe('executeCommand timing', () => {
  it('logs the command, outcome, duration and request id, and nothing from the input', async () => {
    const logger = memoryLogger();
    await expect(
      executeCommand(
        principal(),
        { requestId: 'req-ok' },
        echo,
        { phone: '+919812345678' },
        { logger, clock: fakeClock(10, 27.5) },
      ),
    ).resolves.toEqual({ ok: true });
    expect(logger.entries).toEqual([
      {
        level: 'info',
        event: 'command.completed',
        fields: { name: 'test.echo', outcome: 'ok', durationMs: 17.5, requestId: 'req-ok' },
      },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain('9812345678');
  });

  it('a refused call logs denied at warn when it was slow, after its refusal row is written', async () => {
    const logger = memoryLogger();
    const before = audited.rows.length;
    await expect(
      executeCommand(
        principal({ permissions: [] }),
        { requestId: 'req-denied' },
        echo,
        { phone: '+919812345678' },
        { logger, clock: fakeClock(0, 512) },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(audited.rows.length).toBe(before + 1);
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        event: 'command.completed',
        fields: {
          name: 'test.echo',
          outcome: 'denied',
          errorCode: 'forbidden',
          durationMs: 512,
          requestId: 'req-denied',
        },
      },
    ]);
  });

  it('input that does not parse is logged as failed, with a request id made for the call', async () => {
    const logger = memoryLogger();
    await expect(
      executeCommand(principal(), {}, echo, { phone: 42 }, { logger, clock: fakeClock(0, 1) }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const [entry] = logger.entries;
    expect(entry?.fields).toMatchObject({
      name: 'test.echo',
      outcome: 'failed',
      errorCode: 'validation_failed',
    });
    expect(entry?.fields.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('executeQuery timing', () => {
  it('logs the name it is given, and the request id the context ran with', async () => {
    const logger = memoryLogger();
    let seen: string | undefined;
    const answer = await executeQuery(
      principal(),
      {},
      (context) => {
        seen = context.requestId;
        return Promise.resolve(3);
      },
      { name: 'listLeads', logger, clock: fakeClock(0, 4.04) },
    );
    expect(answer).toBe(3);
    expect(logger.entries).toEqual([
      {
        level: 'info',
        event: 'query.completed',
        fields: { name: 'listLeads', outcome: 'ok', durationMs: 4, requestId: seen },
      },
    ]);
  });

  it("falls back to the function's own name, then to anonymous", async () => {
    const logger = memoryLogger();
    const clock = fakeClock(0);
    function listEntitiesQuery(): Promise<number> {
      return Promise.resolve(1);
    }
    await executeQuery(principal(), { requestId: 'r' }, listEntitiesQuery, { logger, clock });
    await executeQuery(principal(), { requestId: 'r' }, () => Promise.resolve(2), {
      logger,
      clock,
    });
    expect(logger.entries.map((e) => e.fields.name)).toEqual(['listEntitiesQuery', 'anonymous']);
  });

  it('a failed query is logged and its error passed on', async () => {
    const logger = memoryLogger();
    await expect(
      executeQuery(principal(), { requestId: 'r' }, () => Promise.reject(new Error('lost')), {
        name: 'searchLeads',
        logger,
        clock: fakeClock(0, 301),
      }),
    ).rejects.toThrow('lost');
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        event: 'query.completed',
        fields: {
          name: 'searchLeads',
          outcome: 'failed',
          errorCode: 'internal',
          durationMs: 301,
          requestId: 'r',
        },
      },
    ]);
  });

  it('turns the transaction read-only before the query runs, so the query cannot write', async () => {
    audited.statements.length = 0;
    const order: string[] = [];
    await executeQuery(
      principal(),
      { requestId: 'r' },
      () => {
        order.push(...audited.statements.map((s) => new PgDialect().sqlToQuery(s as SQL).sql));
        order.push('query');
        return Promise.resolve(1);
      },
      { name: 'listLeads', logger: memoryLogger(), clock: fakeClock(0) },
    );
    expect(order).toEqual(['set transaction read only', 'query']);
  });
});
