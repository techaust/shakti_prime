import { newId } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAuditPeople, queryAudit } from '../../src/queries/audit/query-audit';

afterAll(closeDb);

/** This file's rows share one command name; five of them share one timestamp. */
const TAG = `test.query.${newId().slice(-8)}`;
const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();

// A minute of its own long ago, so the person filter's answer holds only this file's actors.
const past = Date.UTC(2021, 0, 1) + Math.floor(Math.random() * 500_000) * 60_000;
const pastFrom = new Date(past).toISOString();
const pastTo = new Date(past + 60_000).toISOString();
const people = { one: newId(), two: newId() };

beforeAll(async () => {
  const actor = await createTestPrincipal('executive');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      // One actor in company 1 and another in company 2, in the minute of their own.
      for (const [id, entityId, name] of [
        [people.one, 1, 'Audit person one'],
        [people.two, 2, 'Audit person two'],
      ] as const) {
        await tx`insert into principals (id, kind, display_name) values (${id}, 'user', ${name})`;
        await tx`insert into audit_logs
          (id, entity_id, actor_principal_id, actor_kind, command, outcome, created_at)
          values (${newId()}, ${entityId}, ${id}, 'user', ${TAG}, 'ok', ${new Date(past + 1000)})`;
      }
      for (const entityId of [1, 1, 1, 2, null]) {
        await tx`insert into audit_logs
          (id, entity_id, actor_principal_id, actor_kind, command, aggregate_type, aggregate_id, outcome)
          values (${newId()}, ${entityId}, ${actor.id}, 'user', ${TAG}, 'entity', ${String(entityId)},
                  ${entityId === 2 ? 'denied' : 'ok'})`;
      }
    }),
  );
});

describe('audit.query', () => {
  it('is refused to a role without audit.read', async () => {
    await expect(
      asPrincipal(principalFor('tele_caller_cc', [1]), (ctx) =>
        queryAudit(ctx, { from, to, command: TAG }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('shows entity scope its companies only, and all scope the rows of no company too', async () => {
    const gm = await asPrincipal(principalFor('general_manager', [1]), (ctx) =>
      queryAudit(ctx, { from, to, command: TAG }),
    );
    expect(gm.items.map((r) => r.entityId)).toEqual([1, 1, 1]);
    const exec = await asPrincipal(principalFor('executive'), (ctx) =>
      queryAudit(ctx, { from, to, command: TAG }),
    );
    expect(exec.items.map((r) => r.entityId).sort()).toEqual([1, 1, 1, 2, null].sort());
  });

  it('filters by company, outcome and aggregate', async () => {
    const run = (filter: Record<string, unknown>) =>
      asPrincipal(principalFor('executive'), (ctx) =>
        queryAudit(ctx, { from, to, command: TAG, ...filter }),
      );
    expect((await run({ entityId: 2 })).items).toHaveLength(1);
    expect((await run({ outcome: 'denied' })).items.map((r) => r.entityId)).toEqual([2]);
    expect(
      (await run({ aggregateType: 'entity', aggregateId: 'null' })).items.map((r) => r.entityId),
    ).toEqual([null]);
  });

  it('pages through rows written in one transaction without skipping or repeating one', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await asPrincipal(principalFor('executive'), (ctx) =>
        queryAudit(ctx, { from, to, command: TAG, limit: 2, cursor }),
      );
      seen.push(...result.items.map((r) => r.id));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('refuses a window that runs backwards or spans more than 93 days, and a forged cursor', async () => {
    const exec = principalFor('executive');
    await expect(
      asPrincipal(exec, (ctx) => queryAudit(ctx, { from: to, to: from })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      asPrincipal(exec, (ctx) =>
        queryAudit(ctx, { from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      asPrincipal(exec, (ctx) => queryAudit(ctx, { from, to, cursor: 'bm90IGEgY3Vyc29y' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('audit.query names and people', () => {
  it('names the actor of each row', async () => {
    const page = await asPrincipal(principalFor('executive'), (ctx) =>
      queryAudit(ctx, { from, to, command: TAG }),
    );
    expect(new Set(page.items.map((r) => r.actorName))).toEqual(new Set(['test executive']));
  });

  it('offers the people whose rows the caller may read in the window, by name', async () => {
    const window = { from: pastFrom, to: pastTo };
    const exec = await asPrincipal(principalFor('executive'), (ctx) =>
      listAuditPeople(ctx, window),
    );
    expect(exec).toEqual([
      { id: people.one, name: 'Audit person one' },
      { id: people.two, name: 'Audit person two' },
    ]);
    const gm = await asPrincipal(principalFor('general_manager', [1]), (ctx) =>
      listAuditPeople(ctx, window),
    );
    expect(gm).toEqual([{ id: people.one, name: 'Audit person one' }]);
  });

  it('is refused without audit.read, and refuses a window over 93 days', async () => {
    await expect(
      asPrincipal(principalFor('tele_caller_cc', [1]), (ctx) =>
        listAuditPeople(ctx, { from: pastFrom, to: pastTo }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(principalFor('executive'), (ctx) =>
        listAuditPeople(ctx, { from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
