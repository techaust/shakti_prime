import { newId, type Principal } from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { closeOutboxDb } from '@shakti/db/outbox';
import { asMigrator, closeDb, createTestPrincipal, principalFor } from '@shakti/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The list actions outside a Next.js request, as in actions.test.ts: the headers and the
// signed-in caller are stand-ins; the queries and the database are real.
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

const { createLead, leadFormOptions, listBoardStageLeads, listBoardLeads } =
  await import('../src/actions/crm');
const { listPriceLists } = await import('../src/actions/pricing');
const catalogue = await import('../src/actions/catalogue');

afterAll(async () => {
  await closeAuthDb();
  await closeOutboxDb();
  await closeDb();
});
beforeEach(() => {
  request.principal = undefined;
  request.headers = new Headers();
});

/** The data of a result that must have succeeded. */
function ok<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error}`);
  return result.data;
}

const tag = newId().slice(-10);
const phone = () => `97${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

describe('leadFormOptions', () => {
  it('answers a caller with no session as signed out', async () => {
    await expect(leadFormOptions()).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });

  it('gives the lead form the pipelines with their stages in order, and the lead sources', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const options = ok(await leadFormOptions());
    const farmer = options.pipelines.find((p) => p.key === 'farmer_pumps');
    expect(farmer?.stages.map((s) => s.key)).toEqual([
      'new',
      'contacted',
      'qualified',
      'quoted',
      'won',
      'lost',
    ]);
    expect(options.sources.length).toBeGreaterThan(0);
    // Only what the form shows: a code and a name, nothing internal.
    for (const source of options.sources) {
      expect(Object.keys(source).sort()).toEqual(['code', 'name']);
    }
  });

  it('offers a caller of another company the shared pipelines too', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [3]);
    const keys = ok(await leadFormOptions()).pipelines.map((p) => p.key);
    expect(keys).toContain('farmer_pumps');
  });
});

describe('listPriceLists', () => {
  const tier = newId();
  const ownList = newId();

  beforeAll(async () => {
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into price_tiers (id, code, name) values
          (${tier}, ${`list_actions_${tag}`}, ${`List actions ${tag}`})`;
        await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from) values
          (${ownList}, ${tier}, 1, 1, '2026-04-01')`;
      }),
    );
  });

  it('answers a caller with no session as signed out, and one without pricing.read as refused', async () => {
    await expect(listPriceLists()).resolves.toEqual({ ok: false, error: 'unauthorized' });
    request.principal = principalFor('field_engineer', [1]);
    await expect(listPriceLists()).resolves.toEqual({ ok: false, error: 'forbidden' });
  });

  it('shows a company its own lists, open, and never another company’s', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const mine = ok(await listPriceLists());
    expect(mine.find((l) => l.id === ownList)).toMatchObject({
      tierCode: `list_actions_${tag}`,
      entityId: 1,
      version: 1,
      open: true,
    });
    for (const list of mine) expect(list).not.toHaveProperty('cost');
    request.principal = await createTestPrincipal('tele_caller_cc', [2]);
    const theirs = ok(await listPriceLists());
    expect(theirs.map((l) => l.id)).not.toContain(ownList);
    expect(theirs.every((l) => l.entityId === null || l.entityId === 2)).toBe(true);
  });
});

describe('listBoardStageLeads', () => {
  it('continues a stage of the board after its first page, in the board’s company', async () => {
    request.principal = await createTestPrincipal('tele_caller_cc', [1]);
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const lead = ok(
        await createLead({
          entityId: 1,
          pipelineKey: 'farmer_pumps',
          contact: { name: `Stage page ${tag} ${String(n)}`, phone: phone() },
          account: { type: 'farm' },
        }),
      );
      ids.push(lead.id);
    }
    const board = ok(await listBoardLeads({ entityId: 1, pipelineKey: 'farmer_pumps', limit: 2 }));
    expect(board.items.map((l) => l.id)).toEqual([ids[2], ids[1]]);
    const more = board.more[0];
    if (more === undefined) throw new Error('the stage should continue');
    const next = ok(
      await listBoardStageLeads({
        entityId: 1,
        pipelineKey: 'farmer_pumps',
        stageId: more.stageId,
        cursor: more.cursor,
        limit: 2,
      }),
    );
    expect(next).toMatchObject({ stageId: more.stageId, nextCursor: null });
    expect(next.items.map((l) => l.id)).toEqual([ids[0]]);

    await expect(
      listBoardStageLeads({
        entityId: 2,
        pipelineKey: 'farmer_pumps',
        stageId: more.stageId,
        cursor: more.cursor,
      }),
    ).resolves.toEqual({ ok: false, error: 'forbidden' });
    await expect(
      listBoardStageLeads({
        entityId: 1,
        pipelineKey: 'farmer_pumps',
        stageId: more.stageId,
        cursor: 'not a cursor',
      }),
    ).resolves.toMatchObject({ ok: false, error: 'validation_failed' });
    request.principal = undefined;
    await expect(
      listBoardStageLeads({ pipelineKey: 'farmer_pumps', stageId: more.stageId, cursor: 'x' }),
    ).resolves.toEqual({ ok: false, error: 'unauthorized' });
  });
});

describe('the catalogue reads', () => {
  it('answer as the screen opens: signed out, refused without pricing.read, open with it', async () => {
    await expect(catalogue.listItems({ limit: 5 })).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
    request.principal = principalFor('field_engineer', [1]);
    for (const read of [
      () => catalogue.listItems({ limit: 5 }),
      () => catalogue.listKits({ limit: 5 }),
      () => catalogue.getItem({ itemId: newId() }),
      () => catalogue.getKit({ kitId: newId() }),
    ]) {
      await expect(read()).resolves.toMatchObject({ ok: false, error: 'forbidden' });
    }
    request.principal = principalFor('tele_caller_cc', [1]);
    expect(ok(await catalogue.listItems({ limit: 5 })).items.length).toBeLessThanOrEqual(5);
    expect(ok(await catalogue.listKits({ limit: 5 })).items.length).toBeLessThanOrEqual(5);
  });
});
