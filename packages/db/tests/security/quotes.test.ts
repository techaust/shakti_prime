import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tierId } from '../../seeds/price-tiers';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  principalFor,
  withoutContext,
} from '../../src/testing/index';
import { crmFixture, type CrmFixture } from '../fixtures/crm';

// `quotes`, `quote_lines` and `quote_versions` (docs/DATABASE.md §6.4, migration 0102): children of
// the lead, read with it; made with sales.quote.create over the lead's owner and team, as the
// caller; lines written only in the transaction that made their quote; then only the state and
// the withdrawal reason change; lines and versions are append-only. The expiry and the printer
// reach quotes only through their definers, with their platform-only permissions.

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

/** A price list the test quotes name: archived, so it prices nothing anywhere. */
const LIST = '01990000-0000-7000-8000-0000000f8001';
const ITEM = '01990000-0000-7000-8000-0000000f8002';
const RATE = '01990000-0000-7000-8000-0000000f8003';

let fx: CrmFixture;
/** The fixture's people as Lead Converters (`sales.quote.create` and `.send` at own scope). */
let a: Principal;
let b: Principal;
let teamLead: Principal;
const leadOf = new Map<string, { accountId: string; siteId: string | null }>();

beforeAll(async () => {
  fx = await crmFixture();
  const lc = (p: Principal) =>
    principalFor('tele_caller_lc', p.entityIds, {
      id: p.id,
      ...(p.teamId === undefined ? {} : { teamId: p.teamId }),
    });
  a = lc(fx.principals.a);
  b = lc(fx.principals.b);
  teamLead = fx.principals.l;
  await asMigrator(async (m) => {
    await m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
            values (${LIST}, ${tierId('retail')}, 1, 9100, '2090-01-01', now()) on conflict (id) do nothing`;
    await m`insert into items (id, sku, name, category, hsn) values
            (${ITEM}, 'QRLS-ITEM', 'quote policy item', 'other', '8479') on conflict (id) do nothing`;
    await m`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
            values (${RATE}, ${ITEM}, 0.00, '2090-01-01', 'quote policy test') on conflict (id) do nothing`;
  });
  const rows = await asMigrator(
    (m) => m<{ id: string; account_id: string; site_id: string | null }[]>`
      select id, account_id, site_id from opportunities
       where id = any(${[...fx.leads.a, ...fx.leads.b, ...fx.leads.d]})`,
  );
  for (const row of rows) leadOf.set(row.id, { accountId: row.account_id, siteId: row.site_id });
});

afterAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`alter table quote_lines disable trigger quote_lines_append_only`;
      await tx`alter table quote_versions disable trigger quote_versions_append_only`;
      const quotes = tx`select id from quotes where price_list_id = ${LIST}`;
      await tx`delete from quote_versions where quote_id in (${quotes})`;
      await tx`delete from quote_lines where quote_id in (${quotes})`;
      await tx`delete from quotes where price_list_id = ${LIST}`;
      await tx`alter table quote_lines enable trigger quote_lines_append_only`;
      await tx`alter table quote_versions enable trigger quote_versions_append_only`;
      await tx`delete from tax_rates where id = ${RATE}`;
    }),
  );
  await closeDb();
});

function lead(owner: keyof CrmFixture['leads']): string {
  const id = fx.leads[owner][0];
  if (!id) throw new Error(`fixture lead ${owner} missing`);
  return id;
}

interface QuoteRow {
  id?: string;
  entityId?: number;
  createdBy?: string;
  accountId?: string;
  state?: string;
}

const insertQuote = (opportunityId: string, row: QuoteRow, by: Principal) =>
  sql`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, site_id, tier_id,
                          price_list_id, scheme, place_of_supply_state, supply_kind, valid_until,
                          state, subtotal, cgst, sgst, igst, tax_total, round_off, grand_total,
                          created_by)
      values (${row.id ?? newId()}, ${row.entityId ?? 1}, ${`QRLS/${newId()}`}, '2098-99', ${opportunityId},
              ${row.accountId ?? leadOf.get(opportunityId)?.accountId ?? newId()},
              ${leadOf.get(opportunityId)?.siteId ?? null}, ${tierId('retail')}, ${LIST}, 'none', '08',
              'intra', now() + interval '15 days', ${row.state ?? 'draft'}, 0, 0, 0, 0, 0, 0, 0,
              ${row.createdBy ?? by.id})`;

const insertLine = (quoteId: string, entityId = 1) =>
  sql`insert into quote_lines (id, entity_id, quote_id, position, item_id, sku, description, unit,
                               qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value, cgst,
                               sgst, igst, line_total)
      values (${newId()}, ${entityId}, ${quoteId}, ${Math.floor(Math.random() * 1e6) + 1}, ${ITEM},
              'QRLS-ITEM', 'quote policy item', 'nos', 1, 0, '8479', ${RATE}, 0.00, 0, 0, 0, 0, 0)`;

/** A quote of `owner`'s lead with one line, made in one transaction as `by`. */
async function quoteOf(owner: keyof CrmFixture['leads'], by: Principal): Promise<string> {
  const id = newId();
  await asPrincipal(by, async ({ tx }) => {
    await tx.execute(insertQuote(lead(owner), { id }, by));
    await tx.execute(insertLine(id));
  });
  return id;
}

async function visible(principal: Principal, table: string, id: string): Promise<boolean> {
  const column = table === 'quotes' ? 'id' : 'quote_id';
  const rows = await asPrincipal(principal, ({ tx }) =>
    tx.execute(sql`select 1 from ${sql.identifier(table)} where ${sql.identifier(column)} = ${id}`),
  );
  return (rows as unknown as unknown[]).length > 0;
}

describe('making a quote', () => {
  it('the lead’s owner makes one on their lead, with its lines, in one transaction', async () => {
    const id = await quoteOf('a', a);
    expect(await visible(a, 'quotes', id)).toBe(true);
    expect(await visible(a, 'quote_lines', id)).toBe(true);
  });

  it('a caller without sales.quote.create cannot, even on their own lead', async () => {
    expect(
      await failure(
        asPrincipal(fx.principals.a, ({ tx }) =>
          tx.execute(insertQuote(lead('a'), {}, fx.principals.a)),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('a colleague with own scope cannot make one on another person’s lead; the team lead can', async () => {
    expect(
      await failure(asPrincipal(b, ({ tx }) => tx.execute(insertQuote(lead('a'), {}, b)))),
    ).toMatch(/row-level security/);
    await expect(quoteOf('a', teamLead)).resolves.toBeTruthy();
  });

  it('is refused in another person’s name, in another company and for another customer', async () => {
    const attempt = (row: QuoteRow) =>
      failure(asPrincipal(a, ({ tx }) => tx.execute(insertQuote(lead('a'), row, a))));
    expect(await attempt({ createdBy: fx.principals.b.id })).toMatch(/row-level security/);
    expect(await attempt({ entityId: 2 })).toMatch(/row-level security/);
    expect(await attempt({ accountId: leadOf.get(lead('b'))?.accountId ?? newId() })).toMatch(
      /row-level security|quotes_opportunity_fk/,
    );
  });

  it('takes no line once the transaction that made the quote is over', async () => {
    const id = await quoteOf('a', a);
    expect(await failure(asPrincipal(a, ({ tx }) => tx.execute(insertLine(id))))).toMatch(
      /row-level security/,
    );
  });

  it('is never made in any state but a draft', async () => {
    expect(
      await failure(
        asPrincipal(a, ({ tx }) => tx.execute(insertQuote(lead('a'), { state: 'sent' }, a))),
      ),
    ).toMatch(/row-level security/);
  });
});

describe('reading a quote', () => {
  let quoteId: string;
  beforeAll(async () => {
    quoteId = await quoteOf('a', a);
  });

  it('is seen with the lead: its owner, the team lead and the company’s GM', async () => {
    for (const who of [a, teamLead, fx.principals.gm]) {
      expect(await visible(who, 'quotes', quoteId)).toBe(true);
      expect(await visible(who, 'quote_lines', quoteId)).toBe(true);
    }
  });

  it('is hidden from a colleague who cannot read the lead, from another company and without a request', async () => {
    for (const who of [b, fx.principals.c, fx.principals.d]) {
      expect(await visible(who, 'quotes', quoteId)).toBe(false);
      expect(await visible(who, 'quote_lines', quoteId)).toBe(false);
    }
    expect(await withoutContext(sql`select id from quotes where id = ${quoteId}`)).toEqual([]);
  });
});

describe('changing a quote', () => {
  let quoteId: string;
  beforeAll(async () => {
    quoteId = await quoteOf('a', a);
  });

  it('only its state and withdrawal reason change, by whoever may send or make it', async () => {
    await asPrincipal(a, ({ tx }) =>
      tx.execute(
        sql`update quotes set state = 'sent', state_changed_at = now() where id = ${quoteId}`,
      ),
    );
    expect(
      await failure(
        asPrincipal(a, ({ tx }) =>
          tx.execute(sql`update quotes set grand_total = 1 where id = ${quoteId}`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(
        asPrincipal(a, ({ tx }) =>
          tx.execute(sql`update quotes set pdf_file_id = null where id = ${quoteId}`),
        ),
      ),
    ).toMatch(/permission denied/);
    // A colleague who reads nothing of the lead changes nothing.
    const changed = await asPrincipal(b, ({ tx }) =>
      tx.execute(
        sql`update quotes set state = 'withdrawn', withdrawn_reason = 'x' where id = ${quoteId} returning id`,
      ),
    );
    expect(changed as unknown as unknown[]).toEqual([]);
  });

  it('its lines and versions are never changed or removed, not even by the table owner', async () => {
    expect(
      await failure(
        asPrincipal(a, ({ tx }) =>
          tx.execute(sql`update quote_lines set unit_price = 1 where quote_id = ${quoteId}`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(
        asPrincipal(a, ({ tx }) =>
          tx.execute(sql`delete from quote_lines where quote_id = ${quoteId}`),
        ),
      ),
    ).toMatch(/permission denied/);
    await expect(
      asMigrator((m) => m`update quote_lines set unit_price = 1 where quote_id = ${quoteId}`),
    ).rejects.toThrow(/append-only/);
  });
});

describe('the expiry and the printer reach quotes only through their definers', () => {
  const workers = (permissions: Principal['permissions']) =>
    principalFor('system:workers', [1], { id: SYSTEM_WORKERS_PRINCIPAL_ID, permissions });

  it('refuses the expiry’s definers without sales.quote.expire, and outside the request', async () => {
    for (const statement of [
      sql`select * from app.lapsed_quotes(1::smallint, null, 10)`,
      sql`select * from app.expire_quotes(1::smallint, array[${newId()}]::uuid[])`,
    ]) {
      expect(
        await failure(
          asPrincipal(workers([{ key: 'files.process', scope: 'all' }]), ({ tx }) =>
            tx.execute(statement),
          ),
        ),
      ).toMatch(/sales.quote.expire is required/);
      expect(
        await failure(asPrincipal(principalFor('executive'), ({ tx }) => tx.execute(statement))),
      ).toMatch(/sales.quote.expire is required/);
    }
    expect(
      await failure(
        asPrincipal(workers([{ key: 'sales.quote.expire', scope: 'all' }]), ({ tx }) =>
          tx.execute(sql`select * from app.lapsed_quotes(2::smallint, null, 10)`),
        ),
      ),
    ).toMatch(/outside the request/);
  });

  it('expires only lapsed draft and sent quotes, and nothing else', async () => {
    const lapsed = await quoteOf('a', a);
    const valid = await quoteOf('a', a);
    await asMigrator(
      (m) => m`update quotes set valid_until = now() - interval '1 minute' where id = ${lapsed}`,
    );
    const expirer = workers([{ key: 'sales.quote.expire', scope: 'all' }]);
    const rows = await asPrincipal(expirer, ({ tx }) =>
      tx.execute(
        sql`select quote_id from app.expire_quotes(1::smallint, array[${lapsed}, ${valid}]::uuid[])`,
      ),
    );
    expect((rows as unknown as { quote_id: string }[]).map((r) => r.quote_id)).toEqual([lapsed]);
    const states = await asMigrator(
      (m) => m<{ id: string; state: string }[]>`
        select id, state from quotes where id in (${lapsed}, ${valid})`,
    );
    expect(Object.fromEntries(states.map((s) => [s.id, s.state]))).toEqual({
      [lapsed]: 'expired',
      [valid]: 'draft',
    });
  });

  it('refuses the printer’s definers without files.process', async () => {
    const id = await quoteOf('a', a);
    for (const statement of [
      sql`select app.quote_for_print(${id}::uuid)`,
      sql`select app.attach_quote_pdf(1::smallint, ${id}::uuid, ${newId()}::uuid)`,
    ]) {
      expect(
        await failure(asPrincipal(principalFor('executive'), ({ tx }) => tx.execute(statement))),
      ).toMatch(/files.process is required/);
    }
  });
});

describe('a customer’s price tier', () => {
  it('is set only with pricing.write for all companies, whoever may write the customer', async () => {
    const accountId = leadOf.get(lead('a'))?.accountId ?? '';
    expect(
      await failure(
        asPrincipal(a, ({ tx }) =>
          tx.execute(
            sql`update accounts set tier_id = ${tierId('dealer')} where id = ${accountId}`,
          ),
        ),
      ),
    ).toMatch(/pricing.write/);
    await asPrincipal(principalFor('executive'), ({ tx }) =>
      tx.execute(sql`update accounts set tier_id = ${tierId('dealer')} where id = ${accountId}`),
    );
    // Any other change of the row is still the customer writer's.
    await asPrincipal(a, ({ tx }) =>
      tx.execute(sql`update accounts set name = name where id = ${accountId}`),
    );
    await asMigrator((m) => m`update accounts set tier_id = null where id = ${accountId}`);
  });
});
