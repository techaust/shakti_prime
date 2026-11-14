import {
  newId,
  PLATFORM_ONLY_PERMISSIONS,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type Principal,
} from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PIPELINE_SEED } from '../../seeds/pipelines';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  testPhone,
  withoutContext,
} from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// I1 Lead Ads, lead forms and website ingest (docs/03-roadmap-appendix/phase2.md §6.2): a
// company's connected forms and its website keys are an Executive's (crm.sources.write:all) in
// that company; a sealed Page token and a key's hash are never read back by a request role; a
// lead's qualification facts are read and written with the lead; and the ingest definers answer
// the platform's `crm.ingest.run` alone, in a company of the request. The role × company read of
// the three tables is in role-entity-matrix.test.ts. The suites never clean these tables, so every
// row here is found by this run's own ids.

afterAll(closeDb);

const PUMPS = PIPELINE_SEED[0];
if (!PUMPS) throw new Error('the seeded pipelines are missing');

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

async function rows<T = Record<string, unknown>>(principal: Principal, query: SQL): Promise<T[]> {
  return asPrincipal(principal, async ({ tx }) => (await tx.execute(query)) as unknown as T[]);
}

const workers = (entityIds: readonly number[]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

let fx: CrmFixture;
let exec1: Principal;
let exec2: Principal;
const source = { id: newId(), external: `form${Date.now().toString()}` };
const key = { id: newId(), hash: `${'e'.repeat(48)}${Date.now().toString(16).padStart(16, '0')}` };

beforeAll(async () => {
  fx = await crmFixture();
  exec1 = await createTestPrincipal('executive', [1]);
  exec2 = await createTestPrincipal('executive', [2]);
  await asMigrator(async (m) => {
    await m`insert into ingest_sources (id, entity_id, provider, external_id, name, pipeline_id,
                                        page_token_sealed, created_by)
            values (${source.id}, 1, 'meta_leadgen', ${source.external}, 'Security form',
                    ${PUMPS.id}, ${m.json({ v: 1, sealed: 'not a real envelope' })}, ${exec1.id})`;
    await m`insert into ingest_keys (id, entity_id, label, key_hash, key_hint, created_by)
            values (${key.id}, 1, 'Security key', ${key.hash}, 'abcd', ${exec1.id})`;
  });
});

describe('ingest_sources and ingest_keys', () => {
  it('are read only by an Executive acting in their company', async () => {
    const read = (who: Principal) =>
      rows<{ n: number }>(
        who,
        sql`select (select count(*)::int from ingest_sources where id = ${source.id})
                 + (select count(*)::int from ingest_keys where id = ${key.id}) as n`,
      );
    expect(await read(exec1)).toEqual([{ n: 2 }]);
    expect(await read(exec2)).toEqual([{ n: 0 }]);
    expect(await read(fx.principals.gm)).toEqual([{ n: 0 }]);
    expect(await read(fx.principals.a)).toEqual([{ n: 0 }]);
    expect(await read(workers([1]))).toEqual([{ n: 0 }]);
    expect(
      await withoutContext<{ n: number }>(
        sql`select count(*)::int as n from ingest_sources where id = ${source.id}`,
      ).catch(() => [{ n: -1 }]),
    ).not.toEqual([{ n: 1 }]);
  });

  it('never let a request role read the sealed Page token or a key hash', async () => {
    expect(
      await failure(
        rows(exec1, sql`select page_token_sealed from ingest_sources where id = ${source.id}`),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(rows(exec1, sql`select key_hash from ingest_keys where id = ${key.id}`)),
    ).toMatch(/permission denied/);
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_column_privilege('app_user', 'ingest_sources', 'page_token_sealed', 'SELECT') as "appToken",
             has_column_privilege('app_reader', 'ingest_sources', 'page_token_sealed', 'SELECT') as "readerToken",
             has_column_privilege('readonly_reporter', 'ingest_sources', 'page_token_sealed', 'SELECT') as "reporterToken",
             has_column_privilege('app_user', 'ingest_keys', 'key_hash', 'SELECT') as "appHash",
             has_column_privilege('app_reader', 'ingest_keys', 'key_hash', 'SELECT') as "readerHash",
             has_column_privilege('app_user', 'ingest_sources', 'page_token_set', 'SELECT') as "tokenSet"`);
    expect(grants).toEqual({
      appToken: false,
      readerToken: false,
      reporterToken: false,
      appHash: false,
      readerHash: false,
      tokenSet: true,
    });
  });

  it('refuse a write by another company, a General Manager, and a key made revoked or used', async () => {
    const insertSource = (who: Principal, entityId: number) =>
      rows(
        who,
        sql`insert into ingest_sources (id, entity_id, provider, external_id, name, pipeline_id, created_by)
            values (${newId()}, ${entityId}, 'website', ${`site-${newId()}`}, 'Site', ${PUMPS.id}, ${who.id})`,
      );
    expect(await failure(insertSource(exec2, 1))).toMatch(/row-level security/);
    expect(await failure(insertSource(fx.principals.gm, 1))).toMatch(/row-level security/);
    expect(
      await failure(
        rows(
          exec1,
          sql`insert into ingest_keys (id, entity_id, label, key_hash, key_hint, revoked_at, revoked_by, created_by)
              values (${newId()}, 1, 'Born revoked', ${'f'.repeat(64)}, 'ffff', now(), ${exec1.id}, ${exec1.id})`,
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await failure(
        rows(
          exec1,
          sql`insert into ingest_sources (id, entity_id, provider, external_id, name, pipeline_id, last_lead_at, created_by)
              values (${newId()}, 1, 'website', ${`site-${newId()}`}, 'Site', ${PUMPS.id}, now(), ${exec1.id})`,
        ),
      ),
    ).toMatch(/row-level security/);
    // Only the revoke changes a key, and a revoked key stays revoked.
    expect(
      await failure(
        rows(exec1, sql`update ingest_keys set label = 'Renamed' where id = ${key.id}`),
      ),
    ).toMatch(/permission denied/);
    const other = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into ingest_keys (id, entity_id, label, key_hash, key_hint, revoked_at, revoked_by, created_by)
               values (${other}, 1, 'Revoked', ${`${'d'.repeat(48)}${Date.now().toString(16).padStart(16, '0')}`}, 'dddd', now(), ${exec1.id}, ${exec1.id})`,
    );
    expect(
      await failure(
        rows(
          exec1,
          sql`update ingest_keys set revoked_at = now(), revoked_by = ${exec1.id} where id = ${other}`,
        ),
      ),
    ).toMatch(/stays revoked/);
  });

  it('keep an archived source archived', async () => {
    const archived = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into ingest_sources (id, entity_id, provider, external_id, name, pipeline_id, archived_at, created_by)
               values (${archived}, 1, 'website', ${`site-${archived}`}, 'Old site', ${PUMPS.id}, now(), ${exec1.id})`,
    );
    expect(
      await failure(
        rows(
          exec1,
          sql`update ingest_sources set archived_at = null, updated_by = ${exec1.id} where id = ${archived}`,
        ),
      ),
    ).toMatch(/archived lead source/);
  });
});

describe('lead_qualifications', () => {
  it("are read with the lead, and written only by whoever may write it, never in another company's lead", async () => {
    const leadA = fx.leads.a[0] ?? '';
    await asMigrator(
      (
        m,
      ) => m`insert into lead_qualifications (opportunity_id, entity_id, roof_area_sq_ft, updated_by)
               values (${leadA}, 1, 600, ${fx.principals.a.id})
               on conflict (opportunity_id) do update set roof_area_sq_ft = 600`,
    );
    const read = (who: Principal) =>
      rows<{ n: number }>(
        who,
        sql`select count(*)::int as n from lead_qualifications where opportunity_id = ${leadA}`,
      );
    expect(await read(fx.principals.a)).toEqual([{ n: 1 }]);
    expect(await read(fx.principals.c)).toEqual([{ n: 0 }]);
    expect(await read(fx.principals.d)).toEqual([{ n: 0 }]);
    expect(await read(fx.principals.gm)).toEqual([{ n: 1 }]);

    const write = (who: Principal) =>
      rows(
        who,
        sql`update lead_qualifications set roof_area_sq_ft = 700, updated_by = ${who.id}
             where opportunity_id = ${leadA} returning opportunity_id`,
      );
    expect(await write(fx.principals.a)).toHaveLength(1);
    // Another caller of the company reads nothing to change; a reader of the lead without its
    // write scope is refused.
    expect(await write(fx.principals.c)).toHaveLength(0);
    // A row naming another company than its lead's is refused by the composite key.
    expect(
      await failure(
        asMigrator(
          (m) => m`insert into lead_qualifications (opportunity_id, entity_id, updated_by)
                   values (${fx.leads.d[0] ?? ''}, 1, ${fx.principals.a.id})`,
        ),
      ),
    ).toMatch(/foreign key/);
  });
});

describe('the ingest definers', () => {
  const ALL = [
    sql`select * from app.ingest_source('meta_leadgen', ${source.external})`,
    sql`select app.ingest_source_token(${source.id}::uuid)`,
    sql`select * from app.ingest_key_find(${key.hash})`,
    sql`select app.ingest_record_questions(${source.id}::uuid, '[]'::jsonb)`,
    sql`select * from app.ingest_customer(1::smallint, '+919800000000', 'farmer_pumps', now())`,
    sql`select * from app.ingest_candidates(1::smallint)`,
    sql`select * from app.ingest_team_lead(1::smallint)`,
    sql`select * from app.ingest_pipeline(1::smallint, null, 'farmer_pumps')`,
    sql`select * from app.ingest_lead_write(1::smallint, '{"mode":"create","channel":"website","pipelineKey":"farmer_pumps"}'::jsonb)`,
  ];

  it('answer only crm.ingest.run: every person, an agent and a request with no context are refused', async () => {
    for (const query of ALL) {
      for (const who of [exec1, fx.principals.gm, principalFor('agent:concierge', [1])]) {
        expect(await failure(rows(who, query))).toMatch(/crm\.ingest\.run is required/);
      }
      expect(await failure(withoutContext(query))).toMatch(/crm\.ingest\.run is required|denied/);
    }
  });

  it('refuse a company outside the request', async () => {
    for (const query of ALL.slice(3)) {
      expect(await failure(rows(workers([2]), query))).toMatch(/outside the request/);
    }
    // The token of another company's form is not given.
    expect(
      await rows(workers([2]), sql`select app.ingest_source_token(${source.id}::uuid) as t`),
    ).toEqual([{ t: null }]);
    // A delivery and a website request name no company until their form or key is found: those
    // two lookups answer the platform with none in the request, and say which company it is.
    expect(
      await rows(
        workers([]),
        sql`select entity_id from app.ingest_source('meta_leadgen', ${source.external})`,
      ),
    ).toEqual([{ entity_id: 1 }]);
    expect(
      await rows(workers([]), sql`select key_id, entity_id from app.ingest_key_find(${key.hash})`),
    ).toEqual([{ key_id: key.id, entity_id: 1 }]);
  });

  it('find the form, the token and the key for the platform, and the customer of a number, by ids only', async () => {
    const [found] = await rows(
      workers([1]),
      sql`select source_id, entity_id, pipeline_key, segment, has_page_token
            from app.ingest_source('meta_leadgen', ${source.external})`,
    );
    expect(found).toEqual({
      source_id: source.id,
      entity_id: 1,
      pipeline_key: PUMPS.key,
      segment: PUMPS.segment,
      has_page_token: true,
    });
    expect(
      await rows(workers([1]), sql`select app.ingest_source_token(${source.id}::uuid) as t`),
    ).toEqual([{ t: { v: 1, sealed: 'not a real envelope' } }]);
    const [entity] = await asMigrator(
      (m) => m<{ code: string }[]>`select code from entities where id = 1`,
    );
    expect(await rows(workers([1]), sql`select * from app.ingest_key_find(${key.hash})`)).toEqual([
      { key_id: key.id, entity_id: 1, entity_code: entity?.code },
    ]);
    expect(
      await rows(
        workers([1]),
        sql`select app.ingest_record_questions(${source.id}::uuid,
              '[{"key":"full_name","label":null}]'::jsonb) as recorded`,
      ),
    ).toEqual([{ recorded: true }]);
    const contact = fx.contacts.a[0] ?? '';
    const [phone] = await asMigrator(
      (m) =>
        m<
          { e164: string }[]
        >`select e164 from contact_phones where contact_id = ${contact} limit 1`,
    );
    const [customer] = await rows(
      workers([1]),
      sql`select * from app.ingest_customer(1::smallint, ${phone?.e164 ?? ''}, 'farmer_pumps',
                                           now() - interval '30 days')`,
    );
    expect(Object.keys(customer ?? {}).sort()).toEqual(
      [
        'account_id',
        'contact_id',
        'contact_phone_id',
        'holder_id',
        'holder_team_id',
        'holder_works',
        'lead_id',
        'lead_owner_id',
        'lead_state',
        'language',
      ].sort(),
    );
    expect(
      await rows(
        workers([1]),
        sql`select * from app.ingest_customer(1::smallint, ${`+91${testPhone()}`}, 'farmer_pumps', now())`,
      ),
    ).toEqual([]);
  });

  it('keep crm.ingest.run off every role but the platform, and in the database list', async () => {
    const [list] = await withoutContext<{ keys: string[] }>(
      sql`select app.platform_only_permissions() as keys`,
    );
    expect(list?.keys).toContain('crm.ingest.run');
    expect(list?.keys).toHaveLength(PLATFORM_ONLY_PERMISSIONS.length);
    const [held] = await asMigrator(
      (m) => m<{ roles: string[] }[]>`
        select coalesce(array_agg(r.key order by r.key), '{}') as roles
          from role_permissions rp join roles r on r.id = rp.role_id
         where rp.permission_key = 'crm.ingest.run'`,
    );
    expect(held?.roles).toEqual(['system:workers']);
    const [may] = await withoutContext<{ exec: boolean }>(
      sql`select app.role_may_hold('executive', 'crm.ingest.run') as exec`,
    );
    expect(may?.exec).toBe(false);
  });
});
