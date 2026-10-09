import { CONVERTING_BOARD_LIMIT, newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  stageId,
  tierId,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { loseOpportunity } from '../../src/commands/crm/lose-opportunity';
import { moveOpportunityStage } from '../../src/commands/crm/move-opportunity-stage';
import { recordSizing } from '../../src/commands/crm/record-sizing';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { loadConvertingBoard } from '../../src/queries/crm/converting-board';

// The Lead Converter's board and its next-best-action list (docs/03-roadmap-appendix/phase1.md §9, PRD
// TEL-03): the converter's own open leads with the facts the rules read, under the same policies
// as every other read. The suite works in company 4 with people of its own.

afterAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from sales_orders where price_list_id = ${LIST}`;
      await tx`alter table quote_lines disable trigger quote_lines_append_only`;
      await tx`alter table quote_versions disable trigger quote_versions_append_only`;
      const quotes = tx`select id from quotes where price_list_id = ${LIST}`;
      await tx`delete from quote_versions where quote_id in (${quotes})`;
      await tx`delete from quote_lines where quote_id in (${quotes})`;
      await tx`delete from quotes where price_list_id = ${LIST}`;
      await tx`alter table quote_lines enable trigger quote_lines_append_only`;
      await tx`alter table quote_versions enable trigger quote_versions_append_only`;
    }),
  );
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const crowd = tx`select id from accounts where name like ${`CNV crowd ${tag} %`}`;
      await tx`delete from opportunities where account_id in (${crowd})`;
      await tx`delete from account_entities where account_id in (${crowd})`;
      await tx`delete from accounts where name like ${`CNV crowd ${tag} %`}`;
    }),
  );
  await closeDb();
});

const ENTITY = 4;
const tag = newId().slice(-8);
/** An archived list the fixture quotes and orders name, so it prices nothing anywhere. */
const LIST = '01990000-0000-7000-8000-000000a70001';
const NOW = new Date();
const HOUR = 3_600_000;
const phone = () => `95${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;

let team: string;
let otherTeam: string;
let converter: Principal;
let colleague: Principal;
let teamLead: Principal;
let otherTeamLead: Principal;
let gm: Principal;
let outsider: Principal;
const lead: Record<
  'call' | 'quote' | 'held' | 'early' | 'lost' | 'sized' | 'stale' | 'theirs',
  string
> = {} as never;

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

async function newLead(owner: Principal, name: string, pipelineKey = 'farmer_pumps') {
  const made = (await run(owner, createLead, {
    entityId: ENTITY,
    pipelineKey,
    contact: { name: `${name} ${tag}`, phone: phone() },
    account: { type: 'farm' },
    site: { type: 'borewell', village: `Converting village ${tag}`, pin: '422001' },
  })) as { id: string };
  return made.id;
}

const qualify = (owner: Principal, id: string) =>
  run(owner, moveOpportunityStage, {
    entityId: ENTITY,
    opportunityId: id,
    stageId: stageId(1, 3),
  });

const rooftop = { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 };

async function accountOf(id: string): Promise<string> {
  const [row] = await asMigrator(
    (m) => m<{ account_id: string }[]>`select account_id from opportunities where id = ${id}`,
  );
  if (row === undefined) throw new Error('lead missing');
  return row.account_id;
}

async function quoteFor(id: string, state: string, validUntil: Date): Promise<string> {
  const quoteId = newId();
  const accountId = await accountOf(id);
  await asMigrator(
    (m) => m`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                                price_list_id, scheme, place_of_supply_state, supply_kind, valid_until,
                                state, subtotal, cgst, sgst, igst, tax_total, round_off, grand_total,
                                created_by)
             values (${quoteId}, ${ENTITY}, ${`CNV/${newId()}`}, '2098-99', ${id}, ${accountId},
                     ${tierId('retail')}, ${LIST}, 'none', '08', 'intra', ${validUntil.toISOString()},
                     ${state}, 1180.00, 0, 0, 0, 0, 0, 1180.00, ${converter.id})`,
  );
  return quoteId;
}

const board = (who: Principal, input: object = {}, now = NOW) =>
  asPrincipal(who, (ctx) => loadConvertingBoard(ctx, input, now));

beforeAll(async () => {
  team = await createTestTeam(ENTITY, 'converting team');
  otherTeam = await createTestTeam(ENTITY, 'converting other team');
  converter = await createTestPrincipal('tele_caller_lc', [ENTITY], { teamId: team });
  colleague = await createTestPrincipal('tele_caller_lc', [ENTITY], { teamId: team });
  teamLead = await createTestPrincipal('sales_team_lead', [ENTITY], { teamId: team });
  otherTeamLead = await createTestPrincipal('sales_team_lead', [ENTITY], { teamId: otherTeam });
  gm = await createTestPrincipal('general_manager', [ENTITY]);
  outsider = await createTestPrincipal('general_manager', [3]);
  await asMigrator(
    (m) => m`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
             values (${LIST}, ${tierId('retail')}, ${ENTITY}, 9300, '2090-01-01', now())
             on conflict (id) do nothing`,
  );

  lead.call = await newLead(converter, 'Callback');
  lead.quote = await newLead(converter, 'Quoted');
  lead.held = await newLead(converter, 'Held');
  lead.early = await newLead(converter, 'Early');
  lead.lost = await newLead(converter, 'Lost');
  lead.sized = await newLead(converter, 'Sized');
  lead.stale = await newLead(converter, 'Stale');
  lead.theirs = await newLead(colleague, 'Colleague');
  for (const id of [lead.call, lead.quote, lead.held, lead.sized, lead.stale]) {
    await qualify(converter, id);
  }
  await qualify(colleague, lead.theirs);
  await run(converter, loseOpportunity, {
    entityId: ENTITY,
    opportunityId: lead.lost,
    reasonCode: 'not_interested',
  });
  for (const [owner, id] of [
    [converter, lead.quote],
    [converter, lead.held],
    [converter, lead.sized],
    [converter, lead.stale],
  ] as const) {
    await run(owner, recordSizing, {
      entityId: ENTITY,
      opportunityId: id,
      sizing: { kind: 'rooftop', inputs: rooftop },
    });
  }
  // The stale lead's sizing is from an older engine and must be done again.
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`alter table sizings disable trigger sizings_append_only`;
      await tx`update sizings set engine_version = '1' where opportunity_id = ${lead.stale}`;
      await tx`alter table sizings enable trigger sizings_append_only`;
    }),
  );

  // A callback due an hour ago, and one for tomorrow on the sized lead.
  for (const [id, dueAt] of [
    [lead.call, new Date(NOW.getTime() - HOUR)],
    [lead.sized, new Date(NOW.getTime() + 24 * HOUR)],
  ] as const) {
    await asMigrator(
      (
        m,
      ) => m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind, due_at, created_by)
               select ${newId()}, ${ENTITY}, o.id, o.account_id, ${converter.id}, 'callback', ${dueAt.toISOString()}, ${converter.id}
                 from opportunities o where o.id = ${id}`,
    );
  }
  // A sent quote that lapses in 12 hours; and a held order of the held lead's quote, which has days left.
  await quoteFor(lead.quote, 'sent', new Date(NOW.getTime() + 12 * HOUR));
  const heldQuote = await quoteFor(lead.held, 'sent', new Date(NOW.getTime() + 10 * 24 * HOUR));
  await asMigrator(
    (
      m,
    ) => m`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id,
                                      tier_id, price_list_id, place_of_supply_state, supply_kind, state,
                                      credit_held_at, credit_hold_reason, credit_hold_json, subtotal, cgst, sgst, igst,
                                      tax_total, round_off, grand_total, created_by)
             select ${newId()}, ${ENTITY}, ${`CNV/SO/${tag}`}, '2098-99', ${heldQuote}, o.id, o.account_id,
                    ${tierId('retail')}, ${LIST}, '08', 'intra', 'draft', ${new Date(NOW.getTime() - HOUR).toISOString()},
                    'credit_limit_missing', '{}'::jsonb, 5000.00, 0, 0, 0, 0, 0, 5000.00, ${converter.id}
               from opportunities o where o.id = ${lead.held}`,
  );
});

describe('loadConvertingBoard (PRD TEL-03)', () => {
  it('is refused without calls.log, outside the request, and for another person without team scope', async () => {
    const hr = await createTestPrincipal('hr_admin', [ENTITY]);
    await expect(board(hr)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(board(converter, { entityId: 2 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(board(converter, { ownerId: colleague.id })).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(board(converter, { surprise: true })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('shows the converter only their own open leads, with the facts the rules read', async () => {
    const shown = await board(converter);
    const ids = shown.leads.map((l) => l.opportunityId);
    expect(new Set(ids)).toEqual(
      new Set([lead.call, lead.quote, lead.held, lead.early, lead.sized, lead.stale]),
    );
    expect(ids).not.toContain(lead.lost);
    expect(ids).not.toContain(lead.theirs);
    expect(shown.truncated).toBe(false);
    const by = (id: string) => shown.leads.find((l) => l.opportunityId === id);

    expect(by(lead.call)).toMatchObject({
      stageName: 'Qualified',
      stageKey: 'qualified',
      needsQuote: true,
      sizing: 'none',
      size: null,
      quote: null,
      heldOrder: null,
      nextCall: { kind: 'callback' },
      village: `Converting village ${tag}`,
    });
    expect(by(lead.early)).toMatchObject({ stageKey: 'new', needsQuote: false, sizing: 'none' });
    expect(by(lead.quote)).toMatchObject({
      sizing: 'current',
      size: { kind: 'rooftop' },
      quote: { state: 'sent', grandTotal: '1180.00' },
    });
    expect(by(lead.held)).toMatchObject({
      heldOrder: { grandTotal: '5000.00' },
      // Its quote is sent with days left, so the quote rule is not met.
      quote: { state: 'sent' },
    });
    expect(by(lead.stale)).toMatchObject({ sizing: 'stale', size: null });
    expect(by(lead.sized)?.nextCall?.dueAt).toBe(new Date(NOW.getTime() + 24 * HOUR).toISOString());
  });

  it('makes the list by the rules, most urgent first, each row naming the lead and its panel', async () => {
    const { actions } = await board(converter);
    expect(actions.slice(0, 3).map((a) => [a.opportunityId, a.rule, a.panel])).toEqual([
      [lead.call, 'callback_due', 'calls'],
      [lead.quote, 'quote_expiring', 'quote'],
      [lead.held, 'order_held', 'order'],
    ]);
    // Missing sizings come last.
    expect(actions.slice(3).every((a) => a.rule === 'sizing_missing')).toBe(true);
    const sizing = actions.filter((a) => a.rule === 'sizing_missing').map((a) => a.opportunityId);
    expect(new Set(sizing)).toEqual(new Set([lead.call, lead.stale]));
    // The early lead needs no quote yet, and the sized lead's callback is not due.
    expect(actions.some((a) => a.opportunityId === lead.early)).toBe(false);
    expect(actions.some((a) => a.opportunityId === lead.sized)).toBe(false);
  });

  it('lapses a quote from the list when the moment passes, and shows it expired', async () => {
    const later = new Date(NOW.getTime() + 13 * HOUR);
    const shown = await board(converter, {}, later);
    const quoted = shown.leads.find((l) => l.opportunityId === lead.quote);
    expect(quoted?.quote?.state).toBe('expired');
    expect(shown.actions.some((a) => a.rule === 'quote_expiring')).toBe(false);
  });

  it('shows a team lead the leads of a person of their team, and no one else’s', async () => {
    const theirs = await board(teamLead, { ownerId: converter.id });
    expect(theirs.leads).toHaveLength(6);
    const elsewhere = await board(otherTeamLead, { ownerId: converter.id });
    expect(elsewhere.leads).toEqual([]);
    expect(elsewhere.actions).toEqual([]);
    // A team lead's own board holds only leads they own.
    expect((await board(teamLead)).leads).toEqual([]);
    expect((await board(gm, { ownerId: converter.id })).leads).toHaveLength(6);
  });

  it('shows nothing of another company’s leads', async () => {
    const shown = await board(outsider, { ownerId: converter.id });
    expect(shown.leads).toEqual([]);
  });

  it('narrows to one company when asked, for a person who works in two', async () => {
    const both = await createTestPrincipal('tele_caller_lc', [ENTITY, 3]);
    const here = await newLead(both, 'Two companies here');
    const there = (await run(both, createLead, {
      entityId: 3,
      pipelineKey: 'farmer_pumps',
      contact: { name: `Two companies there ${tag}`, phone: phone() },
      account: { type: 'farm' },
      site: { type: 'borewell', village: `Converting village ${tag}`, pin: '422001' },
    })) as { id: string };
    const ids = (shown: { leads: { opportunityId: string }[] }) =>
      shown.leads.map((l) => l.opportunityId).sort();
    expect(ids(await board(both))).toEqual([here, there.id].sort());
    expect(ids(await board(both, { entityId: ENTITY }))).toEqual([here]);
    expect(ids(await board(both, { entityId: 3 }))).toEqual([there.id]);
  });

  it('says when there are more leads than the board reads, and shows the newest', async () => {
    const crowd = await createTestPrincipal('tele_caller_lc', [ENTITY], { teamId: team });
    const over = CONVERTING_BOARD_LIMIT + 1;
    await asMigrator((m) =>
      m.begin(async (tx) => {
        const [pipeline] = await tx<{ id: string; stage: string }[]>`
          select p.id, (select s.id from pipeline_stages s where s.pipeline_id = p.id
                         order by s.position limit 1) as stage
            from pipelines p where p.key = 'farmer_pumps' and p.entity_id is null`;
        if (pipeline === undefined) throw new Error('no farmer_pumps pipeline');
        await tx`insert into accounts (id, type, name, created_by)
                 select app.uuid_v7(), 'farm', ${`CNV crowd ${tag} `} || g, ${crowd.id}
                   from generate_series(1, ${over}::int) g`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
                 select app.uuid_v7(), a.id, ${ENTITY}, ${crowd.id}, ${team}, ${crowd.id}
                   from accounts a where a.name like ${`CNV crowd ${tag} %`}`;
        await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
                 select app.uuid_v7(), ${ENTITY}, ae.account_id, ${pipeline.id}, ${pipeline.stage},
                        ${crowd.id}, ${team}, ${crowd.id}
                   from account_entities ae join accounts a on a.id = ae.account_id
                  where a.name like ${`CNV crowd ${tag} %`}`;
      }),
    );
    const shown = await board(crowd);
    expect(shown.leads).toHaveLength(CONVERTING_BOARD_LIMIT);
    expect(shown.truncated).toBe(true);
    // One lead fewer is a full board and no more.
    await asMigrator(
      (m) => m`update opportunities set archived_at = now() where id = (
                 select o.id from opportunities o join accounts a on a.id = o.account_id
                  where a.name like ${`CNV crowd ${tag} %`} and o.owner_id = ${crowd.id} limit 1)`,
    );
    const exact = await board(crowd);
    expect(exact.leads).toHaveLength(CONVERTING_BOARD_LIMIT);
    expect(exact.truncated).toBe(false);
  });
});
