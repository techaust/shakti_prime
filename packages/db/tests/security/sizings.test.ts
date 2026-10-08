import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// `sizings` (docs/05-database.md §6.2): a child of the lead, read with it, recorded with the lead's
// write scope as the caller and with the lead's site, and never changed afterwards.

/** The database's message for a refused statement (drizzle wraps it as the cause). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

let fx: CrmFixture;
const sites = new Map<string, string | null>();

beforeAll(async () => {
  fx = await crmFixture();
  const rows = await asMigrator(
    (m) => m<{ id: string; site_id: string | null }[]>`
      select id, site_id from opportunities where id = any(${[...fx.leads.a, ...fx.leads.b, ...fx.leads.c, ...fx.leads.d]})`,
  );
  for (const row of rows) sites.set(row.id, row.site_id);
});
afterAll(closeDb);

function lead(owner: keyof CrmFixture['leads']): string {
  const id = fx.leads[owner][0];
  if (!id) throw new Error(`fixture lead ${owner} missing`);
  return id;
}

interface SizingRow {
  id?: string;
  entityId?: number;
  opportunityId: string;
  siteId?: string | null;
  createdBy?: string;
}

function insertAs(principal: Principal, row: SizingRow) {
  const id = row.id ?? newId();
  return asPrincipal(principal, ({ tx }) =>
    tx.execute(sql`
      insert into sizings (id, entity_id, opportunity_id, site_id, kind, inputs_json, result_json,
                           in_bounds, reasons_json, engine_version, created_by)
      values (${id}, ${row.entityId ?? 1}, ${row.opportunityId},
              ${row.siteId === undefined ? (sites.get(row.opportunityId) ?? null) : row.siteId},
              'rooftop', '{}'::jsonb, '{}'::jsonb, true, '[]'::jsonb, 'test',
              ${row.createdBy ?? principal.id})`),
  ).then(() => id);
}

async function visible(principal: Principal, id: string): Promise<boolean> {
  const rows = await asPrincipal(principal, ({ tx }) =>
    tx.execute(sql`select id from sizings where id = ${id}`),
  );
  return (rows as unknown as unknown[]).length === 1;
}

describe('recording a sizing', () => {
  it('the lead’s owner records one on their lead', async () => {
    const id = await insertAs(fx.principals.a, { opportunityId: lead('a') });
    expect(await visible(fx.principals.a, id)).toBe(true);
  });

  it('a principal that is not a person cannot record one, even with the lead’s write grant', async () => {
    // Only people record a sizing (SECURITY §3.3). The seeded system principal is a principals
    // row of kind system; given the lead grants for the test, the policy still refuses it.
    const [system] = await asMigrator(
      (m) =>
        m<{ id: string }[]>`select id from principals where kind = 'system' order by id limit 1`,
    );
    if (!system) throw new Error('no seeded system principal');
    const service = principalFor('system:workers', [1], {
      id: system.id,
      permissions: [
        { key: 'crm.lead.read', scope: 'entity' },
        { key: 'crm.lead.write', scope: 'entity' },
      ],
    });
    expect(await failure(insertAs(service, { opportunityId: lead('a') }))).toMatch(
      /row-level security/,
    );
  });

  it('a colleague with own scope cannot record one on another person’s lead', async () => {
    expect(await failure(insertAs(fx.principals.b, { opportunityId: lead('a') }))).toMatch(
      /row-level security/,
    );
  });

  it('a team lead records one on a lead of the team', async () => {
    await expect(insertAs(fx.principals.l, { opportunityId: lead('a') })).resolves.toBeTruthy();
  });

  it('is refused in a company the request does not act in', async () => {
    expect(
      await failure(insertAs(fx.principals.d, { opportunityId: lead('a'), entityId: 1 })),
    ).toMatch(/row-level security/);
  });

  it('is refused under another company than the lead’s', async () => {
    const executive = await createTestPrincipal('executive', [1, 2]);
    expect(await failure(insertAs(executive, { opportunityId: lead('d'), entityId: 1 }))).toMatch(
      /sizings_opportunity_entity_fk/,
    );
  });

  it('is refused in another person’s name', async () => {
    expect(
      await failure(
        insertAs(fx.principals.a, { opportunityId: lead('a'), createdBy: fx.principals.b.id }),
      ),
    ).toMatch(/row-level security/);
  });

  it('is refused with a site other than the lead’s', async () => {
    expect(
      await failure(
        insertAs(fx.principals.a, {
          opportunityId: lead('a'),
          siteId: sites.get(lead('b')) ?? null,
        }),
      ),
    ).toMatch(/row-level security/);
  });

  it('keeps in bounds and the reasons in step', async () => {
    await expect(
      asPrincipal(fx.principals.a, ({ tx }) =>
        tx.execute(sql`
          insert into sizings (id, entity_id, opportunity_id, site_id, kind, inputs_json, result_json,
                               in_bounds, reasons_json, engine_version, created_by)
          values (${newId()}, 1, ${lead('a')}, ${sites.get(lead('a')) ?? null}, 'rooftop', '{}', '{}',
                  true, '["roof_too_small"]', 'test', ${fx.principals.a.id})`),
      ),
    ).rejects.toMatchObject({ cause: { constraint_name: 'sizings_reasons_check' } });
  });

  it('names a catalogue pump only on a pump sizing', async () => {
    const item = await asMigrator((m) => m<{ id: string }[]>`select id from items limit 1`);
    const itemId = item[0]?.id ?? newId();
    await expect(
      asMigrator(
        (m) => m`
          insert into sizings (id, entity_id, opportunity_id, site_id, kind, item_id, inputs_json,
                               result_json, in_bounds, reasons_json, engine_version, created_by)
          values (${newId()}, 1, ${lead('a')}, ${sites.get(lead('a')) ?? null}, 'rooftop', ${itemId},
                  '{}', '{}', true, '[]', 'test', ${fx.principals.a.id})`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'sizings_item_kind_check' });
  });
});

describe('reading a sizing', () => {
  let sizingId: string;
  beforeAll(async () => {
    sizingId = await insertAs(fx.principals.a, { opportunityId: lead('a') });
  });

  it('is seen with the lead: its owner, the team lead and the company’s GM', async () => {
    expect(await visible(fx.principals.a, sizingId)).toBe(true);
    expect(await visible(fx.principals.l, sizingId)).toBe(true);
    expect(await visible(fx.principals.gm, sizingId)).toBe(true);
  });

  it('is hidden from a colleague who cannot read the lead and from another company', async () => {
    expect(await visible(fx.principals.b, sizingId)).toBe(false);
    expect(await visible(fx.principals.c, sizingId)).toBe(false);
    expect(await visible(fx.principals.d, sizingId)).toBe(false);
  });

  it('is hidden with no request context at all', async () => {
    expect(await withoutContext(sql`select id from sizings where id = ${sizingId}`)).toEqual([]);
  });
});

describe('sizings are append-only', () => {
  let sizingId: string;
  beforeAll(async () => {
    sizingId = await insertAs(fx.principals.a, { opportunityId: lead('a') });
  });

  it('the application can neither change nor remove one', async () => {
    expect(
      await failure(
        asPrincipal(fx.principals.a, ({ tx }) =>
          tx.execute(sql`update sizings set in_bounds = true where id = ${sizingId}`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(
        asPrincipal(fx.principals.a, ({ tx }) =>
          tx.execute(sql`delete from sizings where id = ${sizingId}`),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('not even the table owner can change one', async () => {
    await expect(
      asMigrator((m) => m`update sizings set engine_version = 'x' where id = ${sizingId}`),
    ).rejects.toThrow(/append-only/);
  });
});
