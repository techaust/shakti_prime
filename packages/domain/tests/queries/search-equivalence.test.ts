import { newId, SearchInput, type Principal } from '@shakti/contracts';
import { schema } from '@shakti/db';
import {
  ALL_ENTITY_IDS,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  principalFor,
} from '@shakti/db/testing';
import { and, desc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { scopeFilter } from '../../src/queries/crm/list-leads';
import { leadSearchQuery } from '../../src/queries/crm/search-leads';
import {
  matchTier,
  resembles,
  similarityTo,
  useNameSimilarity,
} from '../../src/queries/name-match';
import { containsPattern, matchesBySimilarity, phoneDigits } from '../../src/queries/search-text';

// The ⌘K lead search now takes its candidates from app.lead_search_ids() (0052). These tests
// hold it to the query it replaced: for the same callers and texts it must answer the same leads
// in the same order.

afterAll(closeDb);

type SearchContext = Parameters<typeof leadSearchQuery>[0];

/** The digits written backwards, as search-leads.ts turns them for the reversed phone index. */
function backwards(digits: string): string {
  let out = '';
  for (const d of digits) out = d + out;
  return out;
}

/**
 * The oracle: the lead search as it was before 0052, one query under the policies with no
 * candidate lookup (search-leads.ts at b48eb2f). Kept here unchanged.
 */
async function previousLeadSearchQuery(ctx: SearchContext, rawInput: unknown) {
  const input = SearchInput.parse(rawInput);
  const q = input.q;
  const pattern = containsPattern(q);
  const digits = phoneDigits(q);
  const bySpelling = matchesBySimilarity(q);
  if (bySpelling) await useNameSimilarity(ctx.tx);

  const o = schema.opportunities;
  const a = schema.accounts;
  const cs = schema.customerSites;
  const pl = schema.pipelines;
  const ac = schema.accountContacts;
  const c = schema.contacts;
  const ph = schema.contactPhones;

  const contactNamed = exists(
    ctx.tx
      .select({ one: sql`1` })
      .from(ac)
      .innerJoin(c, eq(c.id, ac.contactId))
      .where(
        and(
          eq(ac.accountId, o.accountId),
          or(ilike(c.name, pattern), bySpelling ? resembles(q, c.name) : undefined),
        ),
      ),
  );
  const phoneEnds =
    digits === undefined
      ? undefined
      : inArray(
          o.accountId,
          ctx.tx
            .select({ accountId: ac.accountId })
            .from(ph)
            .innerJoin(ac, eq(ac.contactId, ph.contactId))
            .where(sql`${ph.e164Reversed} ^@ ${backwards(digits)}`),
        );

  const bestContact = (score: (name: typeof c.name) => SQL<number>) =>
    ctx.tx
      .select({ best: sql<number>`max(${score(c.name)})` })
      .from(ac)
      .innerJoin(c, eq(c.id, ac.contactId))
      .where(eq(ac.accountId, o.accountId));
  const tier = sql<number>`greatest(${matchTier(q, a.name)}, ${matchTier(q, cs.village)}, ${bestContact((n) => matchTier(q, n))})`;
  const closeness = sql<number>`greatest(${similarityTo(q, a.name)}, ${similarityTo(q, cs.village)}, ${bestContact((n) => similarityTo(q, n))})`;

  return ctx.tx
    .select({
      id: o.id,
      entityId: o.entityId,
      state: o.state,
      pipelineKey: pl.key,
      customerName: a.name,
      village: cs.village,
    })
    .from(o)
    .innerJoin(a, eq(a.id, o.accountId))
    .innerJoin(pl, eq(pl.id, o.pipelineId))
    .leftJoin(cs, eq(cs.id, o.siteId))
    .where(
      and(
        isNull(o.archivedAt),
        inArray(o.entityId, [...ctx.entityIds]),
        scopeFilter(ctx),
        or(
          ilike(a.name, pattern),
          ilike(cs.village, pattern),
          bySpelling ? resembles(q, a.name) : undefined,
          bySpelling ? resembles(q, cs.village) : undefined,
          contactNamed,
          phoneEnds,
        ),
      ),
    )
    .orderBy(desc(tier), desc(closeness), desc(o.updatedAt), desc(o.id))
    .limit(input.limit);
}

const newTag = () => `e${newId().slice(-12)}${newId().slice(-11)}`;
const tag = newTag();
/** The tag with one character dropped: close in spelling, no longer contained. */
const misspelt = (text: string) => `${text.slice(0, 10)}${text.slice(11)}`;
/** Five digits every seeded phone ends with, so the phone texts find several leads. */
const suffix = String(Math.floor(10_000 + Math.random() * 89_999));
let phoneNo = 100;
const phone = () => `95${String(phoneNo++)}${suffix}`;

let people: Record<
  'caller' | 'teammate' | 'teamLead' | 'gm' | 'gm2' | 'gm3' | 'executive',
  Principal
>;
let firstPhone: string;

async function newLead(
  owner: Principal,
  entityId: number,
  name: string,
  village: string,
  options: { tel?: string; existingAccountId?: string } = {},
) {
  const input =
    options.existingAccountId === undefined
      ? {
          entityId,
          pipelineKey: 'farmer_pumps',
          contact: { name, phone: options.tel ?? phone() },
          account: { type: 'farm' as const },
          site: { type: 'borewell' as const, village, pin: '422001' },
        }
      : { entityId, pipelineKey: 'farmer_pumps', existingAccountId: options.existingAccountId };
  const lead = await asPrincipal(owner, (context) =>
    runCommand(createLead, { context, audit, outbox }, input),
  );
  return lead;
}

beforeAll(async () => {
  const team = await createTestTeam(1, 'search equivalence team');
  people = {
    caller: await createTestPrincipal('tele_caller_cc', [1], { teamId: team }),
    teammate: await createTestPrincipal('tele_caller_cc', [1], { teamId: team }),
    teamLead: await createTestPrincipal('sales_team_lead', [1], { teamId: team }),
    gm: await createTestPrincipal('general_manager', [1]),
    gm2: await createTestPrincipal('general_manager', [2]),
    gm3: await createTestPrincipal('general_manager', [3]),
    executive: await createTestPrincipal('executive', ALL_ENTITY_IDS),
  };
  firstPhone = phone();
  const village = `Village ${tag}`;
  const gram = `Gram ${tag}`;
  const mine = await newLead(people.caller, 1, tag, gram, { tel: firstPhone });
  await newLead(people.caller, 1, `${tag} Joshi`, village);
  await newLead(people.teammate, 1, `Shri ${tag}`, village);
  await newLead(people.teammate, 1, `${misspelt(tag)} Rao`, village);
  await newLead(people.teamLead, 1, `${tag} Patil`, gram);
  await newLead(people.gm, 1, `Pandit ${tag}`, `Pandit ${tag} Khurd`);
  await newLead(people.gm, 1, `Anand ${newTag()}`, gram);
  await newLead(people.gm2, 2, tag, village);
  await newLead(people.gm2, 2, `Shri ${tag} Two`, gram);
  await newLead(people.gm3, 3, `${tag} Three`, village);
  // Enough close names in company 3 that the lookup stops at one of its narrow passes for the
  // callers who read that company: at 0.9 for the tag (twelve more exact names), at 0.7 for the
  // tag misspelt (twelve names that start with it, then the exact ones). The other callers find
  // fewer and go on to the pass that scores every match.
  for (let n = 1; n <= 12; n++) {
    await newLead(people.gm3, 3, tag, `Gram ${newTag()}`);
    await newLead(people.gm3, 3, `${misspelt(tag)} ${String(n)}`, `Gram ${newTag()}`);
  }
  // A customer of company 1 that company 2 also serves (ADR 0008).
  await newLead(people.gm2, 2, '', '', { existingAccountId: mine.account.id });
  // A lead handed to the caller whose customer's relationship the teammate still owns: since 0057
  // the caller reads the customer through the lead, and the search finds it.
  const handed = await newLead(people.teammate, 1, `${tag} Handed`, village);
  // An archived lead, which the search never shows.
  const archived = await newLead(people.caller, 1, `${tag} Kept`, village);
  await asMigrator(async (m) => {
    await m`update opportunities set owner_id = ${people.caller.id} where id = ${handed.id}`;
    await m`update opportunities set archived_at = now() where id = ${archived.id}`;
  });
});

const TEXTS = () => [
  tag,
  tag.toUpperCase(),
  `Shri ${tag}`,
  misspelt(tag),
  `${misspelt(tag)} Rao`,
  `Village ${tag}`,
  `Gram ${misspelt(tag)}`,
  suffix,
  `${suffix.slice(0, 2)} ${suffix.slice(2)}`,
  `+91 ${firstPhone}`,
  // Texts that many rows of other suites also match, so the lookup meets far more matches than it
  // hands back.
  'Ra',
  'ramesh',
];

const CALLERS = [
  'Executive, all companies',
  'Executive, company 2 only',
  'General Manager, company 1',
  'team lead',
  'tele-caller, own leads',
  'tele-caller, teammate',
  'agent that reads leads and customers',
  'agent that reads leads only',
  'co-pilot agent, reads leads only',
] as const;

function caller(label: (typeof CALLERS)[number]): Principal {
  switch (label) {
    case 'Executive, all companies':
      return people.executive;
    case 'Executive, company 2 only':
      return { ...people.executive, entityIds: [2] };
    case 'General Manager, company 1':
      return people.gm;
    case 'team lead':
      return people.teamLead;
    case 'tele-caller, own leads':
      return people.caller;
    case 'tele-caller, teammate':
      return people.teammate;
    case 'agent that reads leads and customers':
      return principalFor('agent:chief', ALL_ENTITY_IDS);
    case 'agent that reads leads only':
      return principalFor('agent:triage', [1, 2]);
    case 'co-pilot agent, reads leads only':
      return principalFor('agent:copilot', ALL_ENTITY_IDS);
  }
}

async function bothAnswers(who: Principal, q: string, limit: number) {
  return asPrincipal(who, async (ctx) => {
    const before = await previousLeadSearchQuery(ctx, { q, limit });
    const { query } = await leadSearchQuery(ctx, { q, limit });
    return { before, after: await query };
  });
}

describe('the lead search through app.lead_search_ids() answers as the query it replaced', () => {
  it.each(CALLERS)('for the %s', { timeout: 120_000 }, async (label) => {
    const who = caller(label);
    let compared = 0;
    for (const q of TEXTS()) {
      for (const limit of [20, 8]) {
        const { before, after } = await bothAnswers(who, q, limit);
        expect(after, `${q} (${String(limit)})`).toEqual(before);
        compared += before.length;
      }
    }
    // The texts do find leads for every caller that reads customers. An agent never reads a
    // customer through its leads (0057), so the agents that read leads only find none.
    if (!label.includes('reads leads only')) expect(compared).toBeGreaterThan(0);
  });

  it('finds the seeded leads it should, so the comparison is not of two empty answers', async () => {
    const { after } = await bothAnswers(people.gm, tag, 20);
    expect(after.map((h) => h.customerName)).toEqual(
      expect.arrayContaining([tag, `${tag} Joshi`, `Shri ${tag}`, `${tag} Patil`]),
    );
    const { after: own } = await bothAnswers(people.caller, tag, 20);
    // The handed lead's customer is readable through the lead (0057); the archived lead is never
    // shown.
    expect(own.map((h) => h.customerName).sort()).toEqual(
      [tag, `${tag} Joshi`, `${tag} Handed`].sort(),
    );
    const { after: company2 } = await bothAnswers(people.gm2, tag, 20);
    expect(company2.every((h) => h.entityId === 2)).toBe(true);
    expect(company2).toHaveLength(3);
  });
});

describe('app.lead_search_ids() hands back the candidates in the search order', () => {
  it.each(CALLERS)('for the %s', { timeout: 120_000 }, async (label) => {
    const who = caller(label);
    for (const q of TEXTS()) {
      const ids = await asPrincipal(who, async (ctx) => {
        const before = await previousLeadSearchQuery(ctx, { q, limit: 20 });
        const digits = phoneDigits(q);
        const reversedDigits = digits === undefined ? null : backwards(digits);
        const rows = (await ctx.tx.execute(
          sql`select id from app.lead_search_ids(${q}::text, ${matchesBySimilarity(q)}::boolean, ${reversedDigits}::text, 20) as id`,
        )) as unknown as { id: string }[];
        return { before: before.map((r) => r.id), candidates: rows.map((r) => r.id) };
      });
      expect(ids.candidates, q).toEqual(ids.before);
    }
  });
});
