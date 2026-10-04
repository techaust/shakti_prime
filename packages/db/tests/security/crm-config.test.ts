import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  CONFIG_TABLES,
  countRows,
  PIPELINE_SEED,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// CRM set-up (docs/design/phase1.md §6.6, 0091): the tables that start empty until the workshop
// answers (CONFIG_TABLES), and the write rules of pipelines, stages, call outcomes, score rules
// and referral partners, checked under RLS without the commands.

const RUN = newId().slice(-8);
const rows = { rules: [] as string[], commissions: [] as string[], outcomes: [] as string[] };

beforeAll(async () => {
  const owner = newId();
  await asMigrator(async (m) => {
    await m`insert into principals (id, kind, display_name) values (${owner}, 'user', 'crm config test')`;
    const groupRule = newId();
    const companyRule = newId();
    const commission = newId();
    rows.rules.push(groupRule, companyRule);
    rows.commissions.push(commission);
    await m`insert into lead_score_rules (id, entity_id, factor, match_json, points, position, created_by) values
      (${groupRule}, null, 'age_days', '{"minDays": 36500}'::jsonb, 1, 50, ${owner}),
      (${companyRule}, 3, 'age_days', '{"minDays": 36500}'::jsonb, 1, 50, ${owner})`;
    await m`insert into commission_rules (id, partner_id, basis, amount, effective_from, created_by)
      values (${commission}, null, 'fixed', 100.00, '2190-04-01', ${owner})`;
  });
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from lead_score_rules where id = any(${rows.rules}::uuid[])`;
    await m`delete from commission_rules where id = any(${rows.commissions}::uuid[])`;
    await m`delete from call_dispositions where id = any(${rows.outcomes}::uuid[])`;
  });
  await closeDb();
});

async function count(principal: Principal, query: ReturnType<typeof sql>): Promise<number> {
  return asPrincipal(principal, async ({ tx }) => {
    const r = (await tx.execute(query)) as unknown as { n: number }[];
    return r[0]?.n ?? 0;
  });
}

/** Rows a statement touched as `principal`, or the error that refused it. */
async function write(principal: Principal, query: ReturnType<typeof sql>): Promise<number | Error> {
  return asPrincipal(principal, async ({ tx }) => {
    const r = (await tx.execute(query)) as unknown as unknown[];
    return r.length;
  }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
}

const refusedByPolicy = (r: number | Error) =>
  r instanceof Error && r.cause instanceof Error && r.cause.message.includes('row-level security');

describe('CONFIG_TABLES fail closed and take no delete', () => {
  it.each(CONFIG_TABLES)('%s returns zero rows with no request context', async (table) => {
    const [row] = await withoutContext<{ n: number }>(countRows(table as never));
    expect(row?.n).toBe(0);
  });

  it.each(CONFIG_TABLES)(
    '%s may be selected, inserted and updated by the app, never deleted',
    async (table) => {
      const [row] = await withoutContext<{ s: boolean; i: boolean; u: boolean; d: boolean }>(sql`
      select has_table_privilege('app_user', ${table}, 'SELECT') as s,
             has_table_privilege('app_user', ${table}, 'INSERT') as i,
             has_table_privilege('app_user', ${table}, 'UPDATE') as u,
             has_table_privilege('app_user', ${table}, 'DELETE') as d`);
      expect(row).toEqual({ s: true, i: true, u: true, d: false });
    },
  );
});

describe('lead score rules', () => {
  it("are read by any caller with a context: the group's and their own company's only", async () => {
    const q = sql`select count(*)::int as n from lead_score_rules where id = any(${`{${rows.rules.join(',')}}`}::uuid[])`;
    expect(await count(principalFor('tele_caller_cc', [1]), q)).toBe(1);
    expect(await count(principalFor('tele_caller_cc', [3]), q)).toBe(2);
    expect(await count(principalFor('executive', []), q)).toBe(1);
  });

  it('are written only with crm.config.write, and group rules only for every company', async () => {
    const insert = (entityId: number | null) => sql`
      insert into lead_score_rules (id, entity_id, factor, match_json, points, position, created_by)
      values (${newId()}, ${entityId}, 'age_days', '{"minDays": 36500}'::jsonb, 1, 50,
              (select id from principals where display_name = 'crm config test' limit 1))
      returning id`;
    expect(refusedByPolicy(await write(principalFor('general_manager', [1]), insert(1)))).toBe(
      true,
    );
    expect(refusedByPolicy(await write(principalFor('executive', [1]), insert(null)))).toBe(true);
    expect(refusedByPolicy(await write(principalFor('executive', [1]), insert(2)))).toBe(true);
    // Run in a transaction that is rolled back, so the rule never lands.
    const inside = await asPrincipal(principalFor('executive', [1]), async ({ tx }) => {
      const r = (await tx.execute(insert(1))) as unknown as { id: string }[];
      throw Object.assign(new Error('rolled back'), { inserted: r.length });
    }).catch((e: unknown) => (e as { inserted?: number }).inserted);
    expect(inside).toBe(1);
  });
});

describe('lead scores', () => {
  // Read from the catalogue, since a fresh database has no lead to write: a check constraint
  // holds for every writer, the commands, the import batch and the migrator alike.
  it('stay between 0 and 100 whoever writes them', async () => {
    const rows = await withoutContext<{ def: string; validated: boolean }>(sql`
      select pg_get_constraintdef(c.oid) as def, c.convalidated as validated
        from pg_constraint c
       where c.conrelid = 'public.opportunities'::regclass
         and c.conname = 'opportunities_score_check'
    `);
    expect(rows).toEqual([{ def: 'CHECK (((score >= 0) AND (score <= 100)))', validated: true }]);
  });
});

describe('commission rules', () => {
  it('are read only with crm.config.write or finance.payment.write', async () => {
    const q = sql`select count(*)::int as n from commission_rules where id = ${rows.commissions[0] ?? ''}`;
    expect(await count(principalFor('executive', [1]), q)).toBe(1);
    expect(await count(principalFor('accounts', [1]), q)).toBe(1);
    const others = [
      'tele_caller_cc',
      'store_manager',
      'general_manager',
      'hr_admin',
      'agent:triage',
    ] as const;
    for (const role of others) {
      expect(await count(principalFor(role, [1]), q)).toBe(0);
    }
  });

  it('are written only by a request acting for every company', async () => {
    const update = sql`update commission_rules set amount = amount where id = ${rows.commissions[0] ?? ''} returning id`;
    expect(await write(principalFor('executive', [1]), update)).toBe(0);
    expect(await write(principalFor('store_manager'), update)).toBe(0);
    expect(await write(principalFor('executive'), update)).toBe(1);
  });
});

describe('pipelines, stages and call outcomes', () => {
  const pipeline = PIPELINE_SEED[0]?.id ?? '';

  it('a group pipeline and its stages are written with crm.config.write:all for every company, no longer with admin.entities.write alone', async () => {
    const pipelineUpdate = sql`update pipelines set lock_hours = lock_hours where id = ${pipeline} returning id`;
    const stageUpdate = sql`update pipeline_stages set name = name where pipeline_id = ${pipeline} returning id`;
    expect(await write(principalFor('executive'), pipelineUpdate)).toBe(1);
    expect(await write(principalFor('executive'), stageUpdate)).toBe(6);
    expect(await write(principalFor('executive', [1]), pipelineUpdate)).toBe(0);
    expect(await write(principalFor('executive', [1]), stageUpdate)).toBe(0);
    const adminOnly = principalFor('general_manager', undefined, {
      permissions: [{ key: 'admin.entities.write', scope: 'all' }],
    });
    expect(await write(adminOnly, pipelineUpdate)).toBe(0);
    expect(await write(principalFor('general_manager'), stageUpdate)).toBe(0);
  });

  it("a company's call outcomes are written for that company only", async () => {
    const id = newId();
    rows.outcomes.push(id);
    const insert = (entityId: number) => sql`
      insert into call_dispositions (id, entity_id, segment, key, code, label, next_action, position)
      values (${id}, ${entityId}, 'commercial_epc', 8, ${`c3_${RUN}`}, 'Policy check', 'retry', 8)`;
    expect(refusedByPolicy(await write(principalFor('executive', [1]), insert(2)))).toBe(true);
    expect(refusedByPolicy(await write(principalFor('general_manager', [2]), insert(2)))).toBe(
      true,
    );
    expect(await write(principalFor('executive', [2]), insert(2))).toBe(0);
    const seen = await count(
      principalFor('tele_caller_cc', [1]),
      sql`select count(*)::int as n from call_dispositions where id = ${id}`,
    );
    expect(seen).toBe(0);
  });
});

describe('referral partners', () => {
  it('are written only with crm.config.write, for a customer of a company in the request', async () => {
    const account = newId();
    const owner = newId();
    await asMigrator(async (m) => {
      await m`insert into principals (id, kind, display_name) values (${owner}, 'user', 'partner owner')`;
      await m`insert into accounts (id, type, name, created_by) values (${account}, 'referral_partner', 'Partner', ${owner})`;
      await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
              values (${newId()}, ${account}, 1, ${owner}, ${owner})`;
    });
    const insert = sql`insert into referral_partners (account_id, code, created_by)
                       values (${account}, ${`P${RUN.slice(0, 6)}`}, ${owner})`;
    // The customer's own caller and the company's GM may update the customer, not its code.
    expect(
      refusedByPolicy(await write(principalFor('tele_caller_cc', [1], { id: owner }), insert)),
    ).toBe(true);
    expect(refusedByPolicy(await write(principalFor('general_manager', [1]), insert))).toBe(true);
    expect(refusedByPolicy(await write(principalFor('executive', [2]), insert))).toBe(true);
    expect(await write(principalFor('executive', [1]), insert)).toBe(0);
    const seen = (principal: Principal) =>
      count(
        principal,
        sql`select count(*)::int as n from referral_partners where account_id = ${account}`,
      );
    expect(await seen(principalFor('tele_caller_cc', [1], { id: owner }))).toBe(1);
    expect(await seen(principalFor('general_manager', [2]))).toBe(0);
    await asMigrator((m) => m`delete from referral_partners where account_id = ${account}`);
  });
});
