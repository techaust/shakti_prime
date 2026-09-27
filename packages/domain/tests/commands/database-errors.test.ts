import { newId } from '@shakti/contracts';
import { asPrincipal, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { schema } from '@shakti/db';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '../../src/command/define-command';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { runCommand } from '../../src/command/run-command';

afterAll(closeDb);

/** A command that lets the database reject the write, so the runner's translation is exercised. */
const insertTier = defineCommand({
  name: 'test.tier.insert',
  permission: 'pricing.write',
  minScope: 'entity',
  input: z.object({ code: z.string() }).strict(),
  output: z.object({ id: z.string() }).strict(),
  async handler(ctx, input) {
    const [row] = await ctx.tx
      .insert(schema.priceTiers)
      .values({
        id: newId(),
        code: input.code,
        name: 'x',
        createdBy: ctx.principal.id,
      })
      .returning({ id: schema.priceTiers.id });
    return { id: row?.id ?? '' };
  },
});

const insertItem = defineCommand({
  name: 'test.item.insert',
  permission: 'catalogue.write',
  minScope: 'entity',
  input: z.object({ hsn: z.string() }).strict(),
  output: z.object({ id: z.string() }).strict(),
  async handler(ctx, input) {
    const [row] = await ctx.tx
      .insert(schema.items)
      .values({
        id: newId(),
        sku: `T-${newId().slice(-8)}`,
        name: 'x',
        category: 'x',
        hsn: input.hsn,
        createdBy: ctx.principal.id,
      })
      .returning({ id: schema.items.id });
    return { id: row?.id ?? '' };
  },
});

describe('database errors inside a command', () => {
  it('a unique violation answers conflict with the constraint named, never the SQL', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const error = await asPrincipal(exec, (context) =>
      runCommand(insertTier, { context, audit, outbox }, { code: 'retail' }),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'conflict',
      details: {
        reason: 'concurrent_change',
        sqlstate: '23505',
        constraint: 'price_tiers_code_unique',
      },
    });
    expect((error as Error).message).not.toContain('insert into');
  });

  it('a check violation answers validation_failed', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(insertItem, { context, audit, outbox }, { hsn: 'abc' }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'database_rejected', sqlstate: '23514', constraint: 'items_hsn_check' },
    });
  });

  it('a row-level security refusal answers forbidden', async () => {
    const cc = await createTestPrincipal('tele_caller_cc', [1], {
      permissions: [{ key: 'pricing.write', scope: 'own' }],
    });
    // Holds pricing.write at own scope only: the runner allows the call, the policy refuses it.
    const denied = defineCommand({ ...insertTier, minScope: 'own' });
    await expect(
      asPrincipal(cc, (context) =>
        runCommand(denied, { context, audit, outbox }, { code: `t-${newId()}` }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden', details: { sqlstate: '42501' } });
  });
});
