import { SYSTEM_WORKERS_PRINCIPAL_ID } from '@shakti/contracts';
import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  PIPELINE_SEED,
  stageId,
  withoutContext,
} from '../../src/testing/index';
import type { RequestTx } from '../../src/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// app.lead_search_ids() (0052): the ⌘K search's candidate lookup, a security definer that uses
// the trigram and reversed-phone indexes the policies keep a plain query from using.

const FIXTURE = '01990000-0000-7000-8000-0000000f';
const SIGNATURE = 'app.lead_search_ids(text, boolean, text, integer)';

let fx: CrmFixture;

beforeAll(async () => {
  fx = await crmFixture();
});
afterAll(closeDb);

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

interface Lookup {
  text: string;
  bySpelling?: boolean;
  phoneReversed?: string | null;
  max?: number;
}

const call = ({ text, bySpelling = false, phoneReversed = null, max = 200 }: Lookup) =>
  sql`select id from app.lead_search_ids(${text}::text, ${bySpelling}::boolean, ${phoneReversed}::text, ${max}::integer) as id`;

/** The candidate ids the lookup answers `principal`, in its order. */
async function candidates(principal: Principal, lookup: Lookup): Promise<string[]> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(call(lookup))) as unknown as { id: string }[];
    return rows.map((r) => r.id);
  });
}

/** The fixture's candidates only, sorted: rows other suites wrote may also match a term. */
async function fixtureCandidates(principal: Principal, lookup: Lookup): Promise<string[]> {
  return (await candidates(principal, lookup)).filter((id) => id.startsWith(FIXTURE)).sort();
}

const sorted = (ids: readonly string[]) => [...ids].sort();

describe('app.lead_search_ids(): who may call it and what it returns', () => {
  it('only the application role may call it', async () => {
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', ${SIGNATURE}, 'execute') as app,
             has_function_privilege('auth_service', ${SIGNATURE}, 'execute') as auth,
             has_function_privilege('outbox_publisher', ${SIGNATURE}, 'execute') as outbox,
             has_function_privilege('readonly_reporter', ${SIGNATURE}, 'execute') as reporter,
             has_function_privilege('public', ${SIGNATURE}, 'execute') as pub
    `);
    expect(grants).toEqual({ app: true, auth: false, outbox: false, reporter: false, pub: false });
  });

  it('returns lead ids and nothing else, as a definer with an empty search path', async () => {
    const [fn] = await withoutContext<{ result: string; definer: boolean; config: string[] }>(sql`
      select pg_get_function_result(p.oid) as result, p.prosecdef as definer, p.proconfig as config
        from pg_proc p where p.oid = ${SIGNATURE}::regprocedure
    `);
    expect(fn?.result).toBe('SETOF uuid');
    expect(fn?.definer).toBe(true);
    expect(fn?.config).toContain('search_path=""');
  });

  it('refuses a caller without crm.lead.read, and a connection with no request', async () => {
    expect(await failure(candidates(principalFor('hr_admin', [1]), { text: 'fixture' }))).toMatch(
      /permission crm.lead.read required/,
    );
    expect(await failure(withoutContext(call({ text: 'fixture' })))).toMatch(
      /permission crm.lead.read required/,
    );
  });
});

describe('app.lead_search_ids(): only leads the caller may read', () => {
  it('keeps own, team and company scope, as opportunities_read does', async () => {
    const lookup = { text: 'fixture' };
    expect(await fixtureCandidates(fx.principals.a, lookup)).toEqual(sorted(fx.leads.a));
    expect(await fixtureCandidates(fx.principals.l, lookup)).toEqual(
      sorted([...fx.leads.a, ...fx.leads.b]),
    );
    expect(await fixtureCandidates(fx.principals.gm, lookup)).toEqual(
      sorted([...fx.leads.a, ...fx.leads.b, ...fx.leads.c]),
    );
    expect(await fixtureCandidates(principalFor('executive', [1, 2]), lookup)).toEqual(
      sorted([...fx.leads.a, ...fx.leads.b, ...fx.leads.c, ...fx.leads.d]),
    );
  });

  it("never returns another company's lead, even of a customer both companies share", async () => {
    // Account 0 is A's customer in company 1 and D's in company 2 (ADR 0008); its lead is in
    // company 1. Company 2 finds its name, its village and its phone, but never that lead.
    const shared = fx.leads.a[0] ?? '';
    const lookups: Lookup[] = [
      { text: 'fixture account 0' },
      { text: 'fixture village 0', bySpelling: true },
      { text: '010000', phoneReversed: '000010' },
      { text: 'fixture' },
    ];
    for (const principal of [fx.principals.d, principalFor('executive', [2])]) {
      for (const lookup of lookups) {
        const found = await fixtureCandidates(principal, lookup);
        expect(found, lookup.text).not.toContain(shared);
        expect(
          found.every((id) => fx.leads.d.includes(id)),
          lookup.text,
        ).toBe(true);
      }
    }
    // Company 1 does find it by each of them.
    for (const lookup of lookups) {
      expect(await fixtureCandidates(principalFor('executive', [1]), lookup)).toContain(shared);
    }
  });

  it('leaves out a lead whose customer the caller may not read, as the policies do', async () => {
    // The triage agent reads leads but not customers: under RLS it cannot read the customer of
    // any lead, so the search, which joins the customer, finds nothing for it.
    const triage = principalFor('agent:triage', [1, 2]);
    expect(await fixtureCandidates(triage, { text: 'fixture' })).toEqual([]);
    const readable = await asPrincipal(triage, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select count(*)::int as n from opportunities o join accounts a on a.id = o.account_id
             where o.id::text like ${`${FIXTURE}%`}`,
      )) as unknown as { n: number }[];
      return rows[0]?.n;
    });
    expect(readable).toBe(0);
  });

  it('finds nothing for the event workers, which read no customer through a lead (0064)', async () => {
    const leadReader = [{ key: 'crm.lead.read' as const, scope: 'entity' as const }];
    const byKey = principalFor('system:workers', [1, 2], { permissions: leadReader });
    const byRow = principalFor('tele_caller_cc', [1, 2], {
      id: SYSTEM_WORKERS_PRINCIPAL_ID,
      permissions: leadReader,
    });
    for (const who of [byKey, byRow]) {
      expect(await fixtureCandidates(who, { text: 'fixture' })).toEqual([]);
    }
    // A person holding the same lead read finds them through the leads, so the search answers.
    const person = principalFor('tele_caller_cc', [1, 2], { permissions: leadReader });
    expect(await fixtureCandidates(person, { text: 'fixture' })).not.toEqual([]);
  });

  it('matches the typed text only as text, never as a pattern', async () => {
    expect(await fixtureCandidates(fx.principals.gm, { text: 'fixture%account' })).toEqual([]);
    expect(await fixtureCandidates(fx.principals.gm, { text: 'fixture_account' })).toEqual([]);
  });
});

describe('app.lead_search_ids(): the cap', () => {
  const tag = `cap${newId().slice(-12)}`;
  let owner: Principal;

  beforeAll(async () => {
    owner = await createTestPrincipal('general_manager', [1]);
    const pipeline = PIPELINE_SEED[0];
    if (!pipeline) throw new Error('pipeline seed missing');
    // 210 customers with one lead each whose names hold the tag.
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`create temp table cap_rows on commit drop as
          select gen_random_uuid() as account_id, gen_random_uuid() as lead_id, n
            from generate_series(1, 210) n`;
        await tx`insert into accounts (id, type, name, created_by)
          select account_id, 'farm', ${tag} || ' ' || n, ${owner.id} from cap_rows`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
          select gen_random_uuid(), account_id, 1, ${owner.id}, ${owner.id} from cap_rows`;
        await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, created_by)
          select lead_id, 1, account_id, ${pipeline.id}, ${stageId(1, 1)}, ${owner.id}, ${owner.id}
            from cap_rows`;
      }),
    );
  });

  afterAll(async () => {
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`delete from opportunities where owner_id = ${owner.id}`;
        await tx`delete from account_entities where owner_id = ${owner.id}`;
        await tx`delete from accounts where name like ${`${tag}%`}`;
      }),
    );
  });

  it('returns at most 200 ids, and at least one, whatever the caller asks for', async () => {
    expect(await candidates(owner, { text: tag, max: 100_000 })).toHaveLength(200);
    expect(await candidates(owner, { text: tag, max: 3 })).toHaveLength(3);
    expect(await candidates(owner, { text: tag, max: 0 })).toHaveLength(1);
  });

  it('keeps the best candidates: the exact name first, then names that start with it', async () => {
    const [exact] = await candidates(owner, { text: `${tag} 7`, max: 1 });
    const names = await asMigrator(
      (m) => m<{ name: string }[]>`select a.name from opportunities o
        join accounts a on a.id = o.account_id where o.id = ${exact ?? ''}`,
    );
    expect(names[0]?.name).toBe(`${tag} 7`);
  });
});

describe('app.lead_search_ids(): served by the indexes', () => {
  type Counts = Map<string, number>;

  /**
   * Scans so far of every index, and full reads of every table (what pg_stat_xact_user_tables
   * shows as seq_scan), in public. Postgres keeps them
   * per connection until it reports them, which it does between transactions at most once a
   * second, so a count read twice in one transaction tells what happened in between.
   */
  async function counters(tx: RequestTx): Promise<{ indexes: Counts; tables: Counts }> {
    const rows = (await tx.execute(sql`
      select c.relname as name, c.relkind as kind, pg_stat_get_xact_numscans(c.oid)::int as scans
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('i', 'r')`)) as unknown as {
      name: string;
      kind: string;
      scans: number;
    }[];
    const pick = (kind: string) =>
      new Map(rows.filter((r) => r.kind === kind).map((r) => [r.name, r.scans]));
    return { indexes: pick('i'), tables: pick('r') };
  }

  /** The index scans and the full table reads the lookup made. */
  async function scansDuring(lookup: Lookup) {
    return asPrincipal(fx.principals.gm, async ({ tx }) => {
      // The suite's tables are small, where a full read is cheapest; turned off only to show
      // that the lookup can use the indexes. docs/04-architecture-appendix/lists.md measures it at 50,000 leads.
      // Plain index scans go too: on a nearly empty table the planner would otherwise walk a
      // primary key end to end, a full read in another form. A bitmap scan needs a condition
      // its index can answer, so what remains is the trigram and reversed-phone indexes. Index-only
      // scans go for the same reason: `accounts_name_id_idx` holds every name, and walking it end
      // to end is a full read of the names.
      await tx.execute(sql`set local enable_seqscan = off`);
      await tx.execute(sql`set local enable_indexscan = off`);
      await tx.execute(sql`set local enable_indexonlyscan = off`);
      await tx.execute(sql`select set_config('pg_trgm.word_similarity_threshold', '0.4', true)`);
      const before = await counters(tx);
      await tx.execute(call(lookup));
      const after = await counters(tx);
      const delta = (kind: 'indexes' | 'tables', name: string) =>
        (after[kind].get(name) ?? 0) - (before[kind].get(name) ?? 0);
      return {
        index: (name: string) => delta('indexes', name),
        seq: (name: string) => delta('tables', name),
      };
    });
  }

  it('finds names and villages through their trigram indexes, not by reading every row', async () => {
    const scans = await scansDuring({ text: 'fixture account 1', bySpelling: true });
    expect(scans.index('accounts_name_trgm_idx')).toBeGreaterThan(0);
    expect(scans.index('contacts_name_trgm_idx')).toBeGreaterThan(0);
    expect(scans.index('customer_sites_village_trgm_idx')).toBeGreaterThan(0);
    for (const table of ['accounts', 'contacts', 'customer_sites', 'opportunities']) {
      expect(scans.seq(table), table).toBe(0);
    }
  });

  it('finds the last digits of a phone through the index on the number backwards', async () => {
    const scans = await scansDuring({ text: '010000', phoneReversed: '000010' });
    expect(scans.index('contact_phones_e164_reversed_idx')).toBeGreaterThan(0);
    expect(scans.seq('contact_phones')).toBe(0);
  });
});
