import { newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { memoryAuditSink } from '../audit/sink';
import { inputHash } from '../idempotency/hash';
import { memoryIdempotencyStore } from '../idempotency/store';
import { memoryOutboxSink } from '../outbox/sink';
import { defineCommand } from './define-command';
import { failureOf, runCommand } from './run-command';
import { fakeContext, type Principal } from './test-support';

// The runner masks an Aadhaar number typed into any command's input before the guard, the
// idempotency key and the handler (docs/07-security.md §5, `maskInputIdentity()`).

/** A valid Aadhaar number (its Verhoeff check digit is 4). */
const AADHAAR = '234567890124';

function person(overrides: Partial<Principal> = {}): Principal {
  return {
    id: newId(),
    kind: 'user',
    roleKey: 'general_manager',
    entityIds: [1],
    permissions: [{ key: 'crm.lead.read', scope: 'entity' }],
    ...overrides,
  };
}

const Input = z
  .object({
    note: z.string(),
    reference: z.string().optional(),
    lines: z.array(z.object({ remark: z.string() }).strict()).optional(),
    at: z.coerce.date().optional(),
  })
  .strict();

const seen: unknown[] = [];

const inner = defineCommand({
  name: 'test.masking.inner',
  permission: 'crm.lead.read',
  auditFields: [],
  input: z.object({ note: z.string() }).strict(),
  output: z.object({ note: z.string() }).strict(),
  handler: (_ctx, input) => {
    seen.push(input);
    return Promise.resolve({ note: input.note });
  },
});

const noting = defineCommand({
  name: 'test.masking.note',
  permission: 'crm.lead.read',
  auditFields: [],
  // The test's own reference, a long number by design.
  unmaskedFields: ['reference'],
  input: Input,
  output: z.object({ note: z.string(), reference: z.string().nullable() }).strict(),
  handler: async (ctx, input) => {
    seen.push(input);
    // An exempt field handed to a command that does not exempt it is masked there.
    if (input.reference !== undefined) await ctx.run(inner, { note: input.reference });
    return { note: input.note, reference: input.reference ?? null };
  },
});

function options(principal: Principal, extra: Record<string, unknown> = {}) {
  return {
    context: fakeContext(principal),
    audit: memoryAuditSink(),
    outbox: memoryOutboxSink(),
    ...extra,
  };
}

describe('runCommand masks the Aadhaar numbers typed into its input', () => {
  it('hands the handler and the audit row the masked input', async () => {
    seen.length = 0;
    const run = options(person());
    const at = '2026-11-09T10:00:00Z';
    const out = await runCommand(noting, run, {
      note: `Aadhaar 2345 6789 0124 given`,
      lines: [{ remark: `card ${AADHAAR}` }],
      at,
    });
    expect(out).toEqual({ note: 'Aadhaar XXXX XXXX 0124 given', reference: null });
    expect(seen).toEqual([
      {
        note: 'Aadhaar XXXX XXXX 0124 given',
        lines: [{ remark: 'card XXXXXXXX0124' }],
        at: new Date(at),
      },
    ]);
    expect((seen[0] as { at: unknown }).at).toBeInstanceOf(Date);
    expect(JSON.stringify(run.audit.records)).not.toContain('23456789');
  });

  it('leaves an exempt field whole, and masks it in a command that does not exempt it', async () => {
    seen.length = 0;
    const out = await runCommand(noting, options(person()), {
      note: 'plain',
      reference: AADHAAR,
    });
    expect(out).toEqual({ note: 'plain', reference: AADHAAR });
    expect(seen).toEqual([{ note: 'plain', reference: AADHAAR }, { note: 'XXXXXXXX0124' }]);
  });

  it('hashes the masked input for the idempotency key, so a repeat as typed replays', async () => {
    const principal = person();
    const idempotency = memoryIdempotencyStore();
    const idempotencyKey = newId();
    const typed = { note: `Aadhaar ${AADHAAR}` };
    const first = await runCommand(
      noting,
      options(principal, { idempotency, idempotencyKey }),
      typed,
    );
    const [row] = [...idempotency.rows.values()];
    expect(row?.inputHash).toBe(inputHash(noting.name, { note: 'Aadhaar XXXXXXXX0124' }));
    expect(JSON.stringify(row)).not.toContain('23456789');
    const run = options(principal, { idempotency, idempotencyKey });
    expect(await runCommand(noting, run, typed)).toEqual(first);
    // A replay writes no audit row.
    expect(run.audit.records).toEqual([]);
    await expect(
      runCommand(noting, options(principal, { idempotency, idempotencyKey }), { note: 'other' }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'idempotency_mismatch' } });
  });

  it('keeps the masked input with a refusal, for the audit row of the denial', async () => {
    const refused = person({ permissions: [] });
    const error: unknown = await runCommand(noting, options(refused), {
      note: `Aadhaar ${AADHAAR}`,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'forbidden' });
    expect(failureOf(error)).toEqual({ stage: 'guard', input: { note: 'Aadhaar XXXXXXXX0124' } });
  });
});
