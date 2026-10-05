import { newId, type Principal } from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { closeOutboxDb } from '@shakti/db/outbox';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The duplicate actions outside a Next.js request, as in list-actions.test.ts: the headers and
// the signed-in caller are stand-ins; the commands, queries and database are real. A customer is
// shared between companies (ADR 0008), so each action runs with every company the caller works
// for, and names the card's company in its input.
const request = vi.hoisted((): { principal: Principal | undefined; headers: Headers } => ({
  principal: undefined,
  headers: new Headers(),
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(request.headers),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));

vi.mock('../src/auth/current-principal', () => ({
  ACTIVE_ENTITY_COOKIE: 'entity',
  TWO_FACTOR_PENDING_COOKIE: 'shakti.two_factor',
  currentPrincipal: () => Promise.resolve(request.principal),
  currentSession: () => Promise.resolve(undefined),
  forgetPrincipal: () => Promise.resolve(),
}));

const { createLead } = await import('../src/actions/crm');
const {
  dismissDuplicate,
  listAccountDuplicates,
  listDuplicates,
  mergeCustomers,
  previewCustomerMerge,
  unmergeCustomers,
} = await import('../src/actions/duplicates');

vi.setConfig({ testTimeout: 60_000 });

afterAll(async () => {
  await closeAuthDb();
  await closeOutboxDb();
  await closeDb();
});
beforeEach(() => {
  request.headers = new Headers();
});

function ok<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

const tag = newId().slice(-8);
const phone = () => `96${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

let caller1: Principal;
let caller2: Principal;
let exec: Principal;
let gm1: Principal;

beforeAll(async () => {
  caller1 = await createTestPrincipal('tele_caller_cc', [1]);
  caller2 = await createTestPrincipal('tele_caller_cc', [2]);
  exec = await createTestPrincipal('executive', [1, 2]);
  gm1 = await createTestPrincipal('general_manager', [1]);
});

/**
 * One customer typed in company 1 and the same person typed again in company 2: lead creation in
 * company 2 records the card there, while the first customer is with company 1 only.
 */
async function crossCompanyPair(n: string) {
  const number = phone();
  const name = `Across ${n} ${tag}`;
  request.principal = caller1;
  const first = ok(
    await createLead({
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      contact: { name, phone: number },
      account: { type: 'farm' },
    }),
  );
  request.principal = caller2;
  const second = ok(
    await createLead({
      entityId: 2,
      pipelineKey: 'farmer_pumps',
      contact: { name, phone: number },
      account: { type: 'farm' },
    }),
  );
  const [card] = await asMigrator(
    (m) => m<{ id: string; entity_id: number }[]>`
      select id, entity_id from duplicate_candidates
       where kind = 'customer' and ${second.account.id} in (account_id, other_account_id)`,
  );
  if (card === undefined) throw new Error('no card');
  expect(card.entity_id).toBe(2);
  return { first: first.account.id, second: second.account.id, cardId: card.id };
}

describe('the duplicate actions for a customer with two companies', () => {
  it('let an Executive of both preview, merge and undo, and a GM of one company hear why not', async () => {
    const pair = await crossCompanyPair('merge');
    const input = { entityId: 2, keptAccountId: pair.first, mergedAccountId: pair.second };

    request.principal = gm1;
    expect(await mergeCustomers({ ...input, entityId: 1 })).toEqual({
      ok: false,
      error: 'merge_other_company',
    });

    request.principal = exec;
    const page = ok(await listDuplicates({}));
    expect(page.items.map((i) => i.id)).toContain(pair.cardId);
    expect(ok(await previewCustomerMerge(input))).toMatchObject({
      contacts: 1,
      leads: 1,
      relationships: 1,
    });
    const merged = ok(await mergeCustomers({ ...input, candidateId: pair.cardId }));
    expect(merged.moved).toMatchObject({ leads: 1, relationships: 1 });
    // The kept customer's page in company 1 offers the undo.
    const cards = ok(await listAccountDuplicates({ entityId: 1, accountId: pair.first }));
    expect(cards.merges.map((m) => m.id)).toContain(merged.id);
    const undone = ok(await unmergeCustomers({ entityId: 2, mergeId: merged.id }));
    expect(undone.moved).toEqual(merged.moved);
    const [row] = await asMigrator(
      (m) => m<{ archived: boolean; state: string }[]>`
        select (select archived_at is not null from accounts where id = ${pair.second}) as archived,
               (select state from duplicate_candidates where id = ${pair.cardId}) as state`,
    );
    expect(row).toEqual({ archived: false, state: 'open' });
  });

  it('let an Executive of both set a card aside', async () => {
    const pair = await crossCompanyPair('dismiss');
    request.principal = exec;
    expect(ok(await dismissDuplicate({ entityId: 2, candidateId: pair.cardId }))).toMatchObject({
      state: 'dismissed',
    });
  });
});
