import {
  AGENT_ROLE_KEYS,
  STAFF_ROLE_KEYS,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type Principal,
} from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tierId } from '../../seeds/price-tiers';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asPrincipal,
  closeDb,
  PIPELINE_SEED,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// The anonymisation of unqualified leads idle for the retention period (BLUEPRINT §7.9,
// docs/03-roadmap-appendix/phase1.md §10, migration m1_retention_rls): only the worker principal,
// through the platform-only crm.retention.run, reaches the two definers; they find exactly the
// leads that never went ahead and that nothing else uses, remove the personal details, keep the
// facts, record each call in retention_runs with no value in it, and do it once.
//
// Every row here has an id starting with the prefix below and a last change in 2001, so this
// file's leads are the oldest of company 1 and come first in its window.

afterAll(closeDb);

const P = '01990000-0000-7000-8000-0000000a7';
const id = (n: number): string => `${P}${n.toString(16).padStart(3, '0')}`;
const MONTHS = 24;
const PRICE_LIST = id(0xff0);
const IMPORT_FILE = id(0xff1);
const IMPORT_JOB = id(0xff2);
const ACTOR = id(0xff3);
const OTHER_ACCOUNT = id(0xff4);
const OTHER_CONTACT = id(0xff5);
const IMPORT_FILE_2 = id(0xff7);
const IMPORT_JOB_2 = id(0xff8);
const EVIDENCE_FILE = id(0xff9);
const AGENT_RUN = id(0xffa);
const AGENT_ACTION = id(0xffb);
const INBOX_ITEM = id(0xffc);
const TRIAGE = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage')?.id ?? '';
/** This run's marker, written into every free-text field of the `marked` lead, and its phone. */
const MARK = `zqxm${Math.random().toString(36).slice(2, 10)}`;
const MARK_DIGITS = `97${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

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

const workers = (entityIds: number[] = [1]): Principal =>
  principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });

function rows<T>(principal: Principal, statement: SQL): Promise<T[]> {
  return asPrincipal(principal, async ({ tx }) => (await tx.execute(statement)) as unknown as T[]);
}

/** What each fixture lead is, so a test reads which ones the job may reach. */
const KINDS = [
  'stale',
  'staleLost',
  'recentNote',
  'withQuote',
  'withOrder',
  'won',
  'otherCompany',
  'qualified',
  'secondLead',
  'dealer',
  'futureTask',
  'sharedContact',
  'openDuplicate',
  'recentCall',
  'failing',
  'marked',
  'qualifiedThenLost',
  'twoStale',
] as const;
type Kind = (typeof KINDS)[number];

interface FixtureLead {
  lead: string;
  account: string;
  contact: string;
  site: string;
}

const leads = {} as Record<Kind, FixtureLead>;
/** The second lead of `secondLead`'s customer, worked on this month, which keeps the customer. */
const SECOND_LEAD = id(0xfe0);
/** The second lead of `twoStale`'s customer, as idle as the first, so both go together. */
const TWO_SIBLING = id(0xfe1);
/** This run's audit rows about the fixture, written before the anonymisation. */
const AUDIT = { staleLead: randomUUID(), staleNote: randomUUID(), keptLead: randomUUID() };

beforeAll(async () => {
  const pipeline = PIPELINE_SEED[0];
  if (pipeline === undefined) throw new Error('pipeline seed missing');
  await asMigrator(async (m) => {
    const [stages] = await m<{ first: string; qualified: string; lost: string }[]>`
      select (select id from pipeline_stages where pipeline_id = ${pipeline.id} and key = 'new') as first,
             (select id from pipeline_stages where pipeline_id = ${pipeline.id} and key = 'qualified'
                 and archived_at is null) as qualified,
             (select id from pipeline_stages where pipeline_id = ${pipeline.id} and kind = 'lost'
                 and archived_at is null order by position limit 1) as lost`;
    const [disposition] = await m<{ id: string }[]>`select id from call_dispositions limit 1`;
    if (stages === undefined || disposition === undefined) throw new Error('seed missing');

    await m.begin(async (tx) => {
      // Remove a previous run, in dependency order; the timeline and calls are append-only.
      const like = `${P}%`;
      await tx`alter table activities disable trigger activities_append_only`;
      await tx`delete from activities where id::text like ${like}`;
      await tx`alter table activities enable trigger activities_append_only`;
      await tx`alter table calls disable trigger calls_append_only`;
      await tx`delete from calls where id::text like ${like}`;
      await tx`alter table calls enable trigger calls_append_only`;
      await tx`alter table agent_actions disable trigger agent_actions_append_only`;
      await tx`delete from agent_actions where id = ${AGENT_ACTION}`;
      await tx`alter table agent_actions enable trigger agent_actions_append_only`;
      await tx`alter table agent_runs disable trigger agent_runs_append_only`;
      await tx`delete from agent_runs where id = ${AGENT_RUN}`;
      await tx`alter table agent_runs enable trigger agent_runs_append_only`;
      await tx`delete from inbox_items where id = ${INBOX_ITEM}`;
      await tx`delete from import_rows where job_id in (${IMPORT_JOB}, ${IMPORT_JOB_2})`;
      await tx`delete from import_jobs where id in (${IMPORT_JOB}, ${IMPORT_JOB_2})`;
      await tx`delete from sales_orders where id::text like ${like}`;
      await tx`delete from quotes where id::text like ${like}`;
      // The nightly duplicate search of other suites may have paired this file's leads.
      await tx`delete from duplicate_candidates
                where id::text like ${like} or opportunity_id::text like ${like}
                   or other_opportunity_id::text like ${like} or account_id::text like ${like}
                   or other_account_id::text like ${like}`;
      await tx`delete from tasks where id::text like ${like}`;
      await tx`delete from consents where id::text like ${like}`;
      await tx`delete from opportunities where id::text like ${like}`;
      await tx`delete from customer_sites where id::text like ${like}`;
      await tx`delete from account_contacts where account_id::text like ${like}`;
      await tx`delete from account_entities where account_id::text like ${like}`;
      await tx`delete from contact_phones where id::text like ${like}`;
      await tx`delete from accounts where id::text like ${like}`;
      await tx`delete from contacts where id::text like ${like}`;
      await tx`delete from files where id in (${IMPORT_FILE}, ${IMPORT_FILE_2}, ${EVIDENCE_FILE})`;
      await tx`delete from price_lists where id = ${PRICE_LIST}`;
      await tx`delete from principals where id = ${ACTOR}`;

      await tx`insert into principals (id, kind, display_name) values (${ACTOR}, 'user', 'retention fixture')`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
               values (${PRICE_LIST}, ${tierId('retail')}, 1, 9131, '2090-01-01', now())`;
      await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                  sha256, status, created_by)
               values (${IMPORT_FILE}, 1, 'import', 'memory', ${`1/import/${IMPORT_FILE}.csv`},
                       'leads.csv', 'text/csv', 100, ${'a7'.repeat(32)}, 'ready', ${ACTOR})`;
      await tx`insert into import_jobs (id, entity_id, kind, file_id, format, columns_json, state,
                                        total_rows, valid_rows, skipped_rows, committed_rows,
                                        created_by)
               values (${IMPORT_JOB}, 1, 'leads', ${IMPORT_FILE}, 'csv', '["Name","Mobile"]',
                       'committed', 2, 1, 1, 1, ${ACTOR})`;
      // A customer that shares a person with `sharedContact`, and that `openDuplicate` is paired with.
      await tx`insert into contacts (id, name, created_by, created_at, updated_at)
               values (${OTHER_CONTACT}, 'retention other person', ${ACTOR}, '2001-01-01', '2001-01-01')`;
      await tx`insert into accounts (id, type, name, created_by, created_at, updated_at)
               values (${OTHER_ACCOUNT}, 'farm', 'retention other customer', ${ACTOR}, '2001-01-01', '2001-01-01')`;
      await tx`insert into account_entities (id, account_id, entity_id, created_by, created_at, updated_at)
               values (${id(0xff6)}, ${OTHER_ACCOUNT}, 1, ${ACTOR}, '2001-01-01', '2001-01-01')`;

      // Lost as `crm.opportunity.lose` leaves a lead: at the pipeline's lost stage, with its
      // timeline row; one of them reached Qualified before it was lost.
      const lostKinds: Kind[] = ['staleLost', 'qualifiedThenLost'];
      for (const [n, kind] of KINDS.entries()) {
        const base = n * 0x10;
        const at = `2001-02-01T00:${String(n).padStart(2, '0')}:00Z`;
        const lead: FixtureLead = {
          lead: id(base + 1),
          account: id(base + 2),
          contact: id(base + 3),
          site: id(base + 4),
        };
        leads[kind] = lead;
        // The marked lead carries this run's marker in every free-text field and its own number.
        const label = kind === 'marked' ? MARK : kind;
        await tx`insert into contacts (id, name, email, created_by, created_at, updated_at)
                 values (${lead.contact}, ${`retention person ${label}`}, ${`${label}@example.in`},
                         ${ACTOR}, ${at}, ${at})`;
        await tx`insert into contact_phones (id, contact_id, e164, is_primary, created_by, created_at, updated_at)
                 values (${id(base + 5)}, ${lead.contact},
                         ${kind === 'marked' ? `+91${MARK_DIGITS}` : `+9197000${String(10000 + n)}`}, true,
                         ${ACTOR}, ${at}, ${at})`;
        await tx`insert into accounts (id, type, name, gstin, created_by, created_at, updated_at)
                 values (${lead.account}, ${kind === 'dealer' ? 'dealer' : 'farm'},
                         ${`retention customer ${label}`}, null, ${ACTOR}, ${at}, ${at})`;
        await tx`insert into account_entities (id, account_id, entity_id, created_by, created_at, updated_at)
                 values (${id(base + 6)}, ${lead.account}, 1, ${ACTOR}, ${at}, ${at})`;
        await tx`insert into account_contacts (account_id, contact_id, role, created_by, created_at, updated_at)
                 values (${lead.account}, ${lead.contact}, 'owner', ${ACTOR}, ${at}, ${at})`;
        await tx`insert into customer_sites (id, account_id, type, address, village, tehsil, district,
                                             state_code, pin, lat, lng, technical_json, created_by,
                                             created_at, updated_at)
                 values (${lead.site}, ${lead.account}, 'borewell', ${`${label} house`},
                         ${`${label} village`}, 'retention tehsil', 'retention district', '27',
                         '999931', 21.1, 79.1, ${tx.json({ remark: `${label} borewell by the well` })}::jsonb,
                         ${ACTOR}, ${at}, ${at})`;
        if (kind === 'marked') {
          // The signed form the consent rests on, kept as proof of consent.
          await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                      sha256, status, created_by)
                   values (${EVIDENCE_FILE}, 1, 'consent_evidence', 'memory',
                           ${`1/consent_evidence/${EVIDENCE_FILE}.pdf`}, ${`${MARK} consent form.pdf`},
                           'application/pdf', 100, ${'c7'.repeat(32)}, 'ready', ${ACTOR})`;
        }
        await tx`insert into consents (id, contact_id, channel, purpose, source, text_version,
                                       given_at, evidence_file_id, created_by, created_at, updated_at)
                 values (${id(base + 7)}, ${lead.contact}, 'call', 'service', 'walk_in_form', 'v1',
                         ${at}, ${kind === 'marked' ? EVIDENCE_FILE : null}, ${ACTOR}, ${at}, ${at})`;
        await tx`insert into opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id,
                                            state, campaign_json, created_by, created_at, updated_at,
                                            state_changed_at)
                 values (${lead.lead}, 1, ${lead.account}, ${lead.site}, ${pipeline.id},
                         ${kind === 'qualified' ? stages.qualified : lostKinds.includes(kind) ? stages.lost : stages.first},
                         ${kind === 'won' ? 'won' : lostKinds.includes(kind) ? 'lost' : 'open'},
                         ${tx.json({ remarks: `${label} called about a pump` })}::jsonb,
                         ${ACTOR}, ${at}, ${at}, ${at})`;
        // Every lead has an old note, an old task with a title and an old call.
        await tx`insert into activities (id, entity_id, opportunity_id, account_id, type,
                                         actor_principal_id, body, created_at)
                 values (${id(base + 8)}, 1, ${lead.lead}, ${lead.account}, 'note', ${ACTOR},
                         ${`${label} asked for a call after harvest`}, ${at})`;
        await tx`insert into activities (id, entity_id, opportunity_id, account_id, type,
                                         actor_principal_id, created_at)
                 values (${id(base + 9)}, 1, ${lead.lead}, ${lead.account}, 'lead_created', ${ACTOR}, ${at})`;
        await tx`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind,
                                    title, due_at, state, created_by, created_at, updated_at)
                 values (${id(base + 10)}, 1, ${lead.lead}, ${lead.account}, ${ACTOR}, 'callback',
                         ${`call ${label} back`},
                         ${kind === 'futureTask' ? tx`now() + interval '7 days'` : at},
                         'open', ${ACTOR}, ${at}, ${at})`;
        await tx`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series,
                                    disposition_id, attempt_no, started_at, created_at)
                 values (${id(base + 11)}, 1, ${lead.lead}, ${ACTOR}, 'outbound', 'manual',
                         ${disposition.id}, 1,
                         ${kind === 'recentCall' ? tx`now()` : at},
                         ${kind === 'recentCall' ? tx`now()` : at})`;
        if (kind === 'qualifiedThenLost') {
          await tx`insert into activities (id, entity_id, opportunity_id, account_id, type,
                                           actor_principal_id, payload_json, created_at)
                   values (${id(base + 12)}, 1, ${lead.lead}, ${lead.account}, 'stage_moved', ${ACTOR},
                           ${tx.json({ fromStageId: stages.first, toStageId: stages.qualified, toStageKey: 'qualified' })}::jsonb,
                           ${at})`;
        }
        if (lostKinds.includes(kind)) {
          await tx`insert into activities (id, entity_id, opportunity_id, account_id, type,
                                           actor_principal_id, payload_json, created_at)
                   values (${id(base + 13)}, 1, ${lead.lead}, ${lead.account}, 'lost', ${ACTOR},
                           ${tx.json({ reasonCode: 'not_interested', stageId: stages.lost })}::jsonb,
                           ${at})`;
        }
      }

      await tx`insert into activities (id, entity_id, opportunity_id, account_id, type,
                                       actor_principal_id, body)
               values (${id(0xfd0)}, 1, ${leads.recentNote.lead}, ${leads.recentNote.account},
                       'note', ${ACTOR}, 'asked again this month')`;
      for (const [kind, quote] of [
        ['withQuote', id(0xfd1)],
        ['withOrder', id(0xfd2)],
      ] as const) {
        await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                                     price_list_id, scheme, place_of_supply_state, supply_kind,
                                     valid_until, state, subtotal, cgst, sgst, igst, tax_total,
                                     round_off, grand_total, created_by, created_at, updated_at)
                 values (${quote}, 1, ${`RET/Q/${kind}`}, '2000-01', ${leads[kind].lead},
                         ${leads[kind].account}, ${tierId('retail')}, ${PRICE_LIST}, 'none', '27',
                         'intra', '2001-03-01', 'expired', 0, 0, 0, 0, 0, 0, 0, ${ACTOR},
                         '2001-02-01', '2001-02-01')`;
      }
      await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id,
                                         tier_id, place_of_supply_state, supply_kind, state, subtotal,
                                         cgst, sgst, igst, tax_total, round_off, grand_total,
                                         created_by, created_at, updated_at)
               values (${id(0xfd3)}, 1, 'RET/SO/1', '2000-01', ${id(0xfd2)}, ${leads.withOrder.lead},
                       ${leads.withOrder.account}, ${tierId('retail')}, '27', 'intra', 'draft',
                       0, 0, 0, 0, 0, 0, 0, ${ACTOR}, '2001-02-01', '2001-02-01')`;
      await tx`insert into account_entities (id, account_id, entity_id, created_by, created_at, updated_at)
               values (${id(0xfd4)}, ${leads.otherCompany.account}, 2, ${ACTOR}, '2001-01-01', '2001-01-01')`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, created_by,
                                          created_at, updated_at, state_changed_at)
               values (${SECOND_LEAD}, 1, ${leads.secondLead.account}, ${pipeline.id}, ${stages.first},
                       ${ACTOR}, '2001-01-01', now(), '2001-01-01'),
                      (${TWO_SIBLING}, 1, ${leads.twoStale.account}, ${pipeline.id}, ${stages.first},
                       ${ACTOR}, '2001-03-01', '2001-03-01', '2001-03-01')`;
      // The audit trail written before the run: the stale lead's creation with its person, a note
      // naming its customer in the input only, and a kept lead's creation.
      await tx`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command,
                                       aggregate_type, aggregate_id, outcome, input_json, after_json)
               values (${AUDIT.staleLead}, 1, ${ACTOR}, 'user', 'crm.lead.create', 'opportunity',
                       ${leads.stale.lead}, 'ok',
                       ${tx.json({ entityId: 1, contact: { name: 'retention person stale', phone: '********0000' }, site: { village: 'stale village' } })}::jsonb,
                       ${tx.json({ accountId: leads.stale.account, score: 50, consent: null })}::jsonb),
                      (${AUDIT.staleNote}, 1, ${ACTOR}, 'user', 'crm.note.add', null, null, 'ok',
                       ${tx.json({ entityId: 1, accountId: leads.stale.account, body: 'stale asked for a call after harvest' })}::jsonb,
                       null),
                      (${AUDIT.keptLead}, 1, ${ACTOR}, 'user', 'crm.lead.create', 'opportunity',
                       ${leads.qualified.lead}, 'ok',
                       ${tx.json({ entityId: 1, contact: { name: 'retention person qualified' } })}::jsonb,
                       null)`;
      await tx`insert into account_contacts (account_id, contact_id, role, created_by, created_at, updated_at)
               values (${OTHER_ACCOUNT}, ${leads.sharedContact.contact}, 'family', ${ACTOR},
                       '2001-01-01', '2001-01-01')`;
      const [low, high] = [leads.openDuplicate.account, OTHER_ACCOUNT].sort();
      await tx`insert into duplicate_candidates (id, entity_id, kind, account_id, other_account_id,
                                                 reason, confidence, created_by, created_at, updated_at)
               values (${id(0xfd5)}, 1, 'customer', ${low ?? ''}, ${high ?? ''}, 'phone', 90,
                       ${ACTOR}, '2001-01-01', '2001-01-01')`;
      // The marked lead's import file, its routed work and the Triage agent's proposal with a note.
      const marked = leads.marked;
      await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                  sha256, status, created_by)
               values (${IMPORT_FILE_2}, 1, 'import', 'memory', ${`1/import/${IMPORT_FILE_2}.csv`},
                       'customers.csv', 'text/csv', 100, ${'b7'.repeat(32)}, 'ready', ${ACTOR})`;
      await tx`insert into import_jobs (id, entity_id, kind, file_id, format, columns_json, state,
                                        total_rows, valid_rows, committed_rows, created_by)
               values (${IMPORT_JOB_2}, 1, 'leads', ${IMPORT_FILE_2}, 'csv', '["Name","Mobile"]',
                       'committed', 1, 1, 1, ${ACTOR})`;
      await tx`insert into import_rows (job_id, entity_id, row_no, raw_json, normalised_json, dedupe_json,
                                        state, created_type, created_id, committed_batch, created_by)
               values (${IMPORT_JOB_2}, 1, 1, ${tx.json({ Name: MARK, Mobile: MARK_DIGITS })}::jsonb,
                       ${tx.json({ name: MARK, phone: `+91${MARK_DIGITS}` })}::jsonb,
                       ${tx.json({ inFileRowNo: null, existing: [] })}::jsonb,
                       'committed', 'opportunity', ${marked.lead}, 1, ${ACTOR})`;
      await tx`insert into inbox_items (id, entity_id, kind, subject_type, subject_id, segment, note,
                                        created_by, created_at, updated_at)
               values (${INBOX_ITEM}, 1, 'routed_work', 'opportunity', ${marked.lead}, 'farmer_pumps',
                       ${`${MARK} wants a pump for the far field`}, ${ACTOR},
                       '2001-02-01', '2001-02-01')`;
      await tx`insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type,
                                       outcome, request_id, created_at)
               values (${AGENT_RUN}, 1, 'agent:triage', ${TRIAGE}, 'triage', 'triage.pipeline.choose',
                       'shadowed', 'retention-fixture', '2001-02-01')`;
      await tx`insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json,
                                          autonomy, state, created_by, created_at)
               values (${AGENT_ACTION}, 1, ${AGENT_RUN}, 'agent:triage', 'triage.pipeline.choose',
                       ${tx.json({ entityId: 1, opportunityId: marked.lead, pipelineKey: 'farmer_pumps', note: `${MARK} sounds keen` })}::jsonb,
                       'shadow', 'shadowed', ${TRIAGE}, '2001-02-01')`;
      // An import file whose row made `stale`, and a later row skipped as its repeat.
      await tx`insert into import_rows (job_id, entity_id, row_no, raw_json, normalised_json, state,
                                        created_type, created_id, committed_batch, created_by)
               values (${IMPORT_JOB}, 1, 1, ${tx.json({ Name: 'retention person stale', Mobile: '9700010000' })}::jsonb,
                       ${tx.json({ name: 'retention person stale' })}::jsonb, 'committed',
                       'opportunity', ${leads.stale.lead}, 1, ${ACTOR}),
                      (${IMPORT_JOB}, 1, 2, ${tx.json({ Name: 'retention person stale', Mobile: '9700010000' })}::jsonb,
                       null, 'skipped', null, null, null, ${ACTOR})`;
      await tx`update import_rows set dedupe_json = ${tx.json({ inFileRowNo: 1, existing: [] })}::jsonb
               where job_id = ${IMPORT_JOB} and row_no = 2`;
    });
  });
});

/**
 * The fixture leads the job may anonymise: those that never went ahead and that nothing else uses,
 * a lead lost before Qualified among them, and a customer whose two leads are both idle.
 */
const ELIGIBLE: Kind[] = ['stale', 'staleLost', 'failing', 'marked', 'twoStale'];
/** The leads kept for good: Qualified reached (lost after or not), a quote, an order, a dealer. */
const KEPT: Kind[] = ['qualified', 'qualifiedThenLost', 'withQuote', 'withOrder', 'dealer'];

async function windowFlags(): Promise<Record<string, { stale: boolean; kept: boolean }>> {
  const found = await rows<{ lead_id: string; stale: boolean; kept: boolean }>(
    workers(),
    sql`select lead_id, stale, kept from app.stale_leads(1::smallint, ${MONTHS}, null, null, 500)`,
  );
  return Object.fromEntries(found.map((r) => [r.lead_id, { stale: r.stale, kept: r.kept }]));
}

async function staleFlags(): Promise<Record<string, boolean>> {
  const flags = await windowFlags();
  return Object.fromEntries(Object.entries(flags).map(([lead, f]) => [lead, f.stale]));
}

describe('who may reach the definers', () => {
  const statements = [
    sql`select * from app.stale_leads(1::smallint, ${MONTHS}, null, null, 10)`,
    sql`select app.anonymise_stale_leads(1::smallint, ${MONTHS}, array[]::uuid[])`,
  ];

  it('refuses every person’s role, every agent and the workers without crm.retention.run', async () => {
    const refused: Principal[] = [
      ...STAFF_ROLE_KEYS.map((role) => principalFor(role, [1])),
      ...AGENT_ROLE_KEYS.map((role) => principalFor(role, [1])),
      principalFor('system:workers', [1], {
        id: SYSTEM_WORKERS_PRINCIPAL_ID,
        permissions: [{ key: 'crm.score.refresh', scope: 'all' }],
      }),
    ];
    for (const principal of refused) {
      for (const statement of statements) {
        expect({
          role: principal.roleKey,
          message: await failure(rows(principal, statement)),
        }).toEqual({
          role: principal.roleKey,
          message: expect.stringMatching(/crm.retention.run is required/) as string,
        });
      }
    }
  });

  it('fails closed with no request context', async () => {
    for (const statement of statements) {
      expect(await failure(withoutContext(statement))).toMatch(/crm.retention.run is required/);
    }
  });

  it('refuses a company outside the request and a period under a year', async () => {
    for (const statement of [
      sql`select * from app.stale_leads(2::smallint, ${MONTHS}, null, null, 10)`,
      sql`select app.anonymise_stale_leads(2::smallint, ${MONTHS}, array[]::uuid[])`,
    ]) {
      expect(await failure(rows(workers([1]), statement))).toMatch(/outside the request/);
    }
    for (const statement of [
      sql`select * from app.stale_leads(1::smallint, 6, null, null, 10)`,
      sql`select app.anonymise_stale_leads(1::smallint, 11, array[]::uuid[])`,
    ]) {
      expect(await failure(rows(workers([1]), statement))).toMatch(/between 12 and 120 months/);
    }
  });

  it('keeps crm.retention.run to the worker principal: no role holds it, and the database refuses it to one', async () => {
    const held = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from role_permissions rp
          join roles r on r.id = rp.role_id
         where rp.permission_key = 'crm.retention.run' and r.key not like 'system:%'`,
    );
    expect(held[0]?.n).toBe(0);
    const [list] = await withoutContext<{ keys: string[] }>(
      sql`select app.platform_only_permissions() as keys`,
    );
    expect(list?.keys).toContain('crm.retention.run');
  });

  it('lets the reader pool count but never anonymise', async () => {
    const grants = await withoutContext<{ count: boolean; write: boolean }>(sql`
      select has_function_privilege('app_reader',
               'app.stale_leads(smallint, integer, timestamptz, uuid, integer)', 'EXECUTE') as count,
             has_function_privilege('app_reader',
               'app.anonymise_stale_leads(smallint, integer, uuid[])', 'EXECUTE') as write`);
    expect(grants[0]).toEqual({ count: true, write: false });
  });
});

describe('which leads the job reaches', () => {
  it('finds stale exactly the leads that never went ahead and that nothing else uses', async () => {
    const flags = await staleFlags();
    for (const kind of KINDS) {
      expect({ kind, stale: flags[leads[kind].lead] ?? false }).toEqual({
        kind,
        stale: ELIGIBLE.includes(kind),
      });
    }
    // A customer's live second lead keeps it; a customer's two idle leads go together.
    expect(flags[SECOND_LEAD]).toBeUndefined();
    expect(flags[TWO_SIBLING]).toBe(true);
    const window = await windowFlags();
    for (const kind of KINDS) {
      expect({ kind, kept: window[leads[kind].lead]?.kept ?? false }).toEqual({
        kind,
        kept: KEPT.includes(kind),
      });
    }
    // A won lead is never even looked at.
    expect(flags[leads.won.lead]).toBeUndefined();
  });

  it('looks at the oldest change first and hands the next batch a cursor', async () => {
    const first = await rows<{ lead_id: string; changed_at: string }>(
      workers(),
      sql`select lead_id, changed_at from app.stale_leads(1::smallint, ${MONTHS}, null, null, 2)`,
    );
    expect(first.map((r) => r.lead_id)).toEqual([leads.stale.lead, leads.staleLost.lead]);
    expect(first[0]?.changed_at).toBe('2001-02-01T00:00:00.000000Z');
    const last = first[1];
    const next = await rows<{ lead_id: string }>(
      workers(),
      sql`select lead_id from app.stale_leads(1::smallint, ${MONTHS},
                 ${last?.changed_at ?? null}::timestamptz, ${last?.lead_id ?? null}::uuid, 2)`,
    );
    expect(next.map((r) => r.lead_id)).toEqual([leads.recentNote.lead, leads.withQuote.lead]);
  });
});

describe('the anonymisation', () => {
  const all = (): string[] => [...KINDS.map((k) => leads[k].lead), SECOND_LEAD, TWO_SIBLING];
  const anonymised = (): string[] => [...ELIGIBLE.map((k) => leads[k].lead), TWO_SIBLING];
  const run = (ids: string[], kept: string[] = []) =>
    rows<{ result: { leads: string[]; kept: number; failed: number; error: string | null } }>(
      workers(),
      sql`select app.anonymise_stale_leads(1::smallint, ${MONTHS}, ${`{${ids.join(',')}}`}::uuid[],
                                           ${`{${kept.join(',')}}`}::uuid[]) as result`,
    ).then((r) => r[0]?.result);

  async function lastRun(): Promise<{ rows_affected: number; error: string | null } | undefined> {
    const [row] = await asMigrator(
      (m) => m<{ rows_affected: number; error: string | null }[]>`
        select rows_affected, error from retention_runs
         where job = 'leads-anonymise' order by started_at desc limit 1`,
    );
    return row;
  }

  it('records a failure by its code alone and changes nothing', async () => {
    const target = leads.failing;
    // A refusal whose message carries a personal value, as a database error may.
    await asMigrator(async (m) => {
      await m.unsafe(`
        create or replace function public.retention_test_refuse() returns trigger
          language plpgsql as $$
        begin
          if new.id = '${target.contact}'::uuid then
            raise exception 'refused for %', old.name;
          end if;
          return new;
        end $$`);
      await m.unsafe(`create trigger retention_test_refuse before update on contacts
                        for each row execute function public.retention_test_refuse()`);
    });
    try {
      const result = await run([target.lead]);
      expect(result).toEqual({ leads: [], kept: 0, failed: 1, error: 'failed with code P0001' });
      expect(await lastRun()).toEqual({
        rows_affected: 0,
        error: 'failed with code P0001 for 1 customer',
      });
    } finally {
      await asMigrator(async (m) => {
        await m`drop trigger retention_test_refuse on contacts`;
        await m`drop function public.retention_test_refuse()`;
      });
    }
    const [state] = await asMigrator(
      (m) => m<{ phones: number; notes: number; name: string; anonymised: Date | null }[]>`
        select (select count(*)::int from contact_phones where contact_id = ${target.contact}) as phones,
               (select count(*)::int from activities where account_id = ${target.account} and type = 'note') as notes,
               (select name from accounts where id = ${target.account}) as name,
               (select anonymised_at from opportunities where id = ${target.lead}) as anonymised`,
    );
    expect(state).toEqual({
      phones: 1,
      notes: 1,
      name: 'retention customer failing',
      anonymised: null,
    });
  });

  it('anonymises only the stale customers it is given, each with all its leads, and marks the kept', async () => {
    const before = await asMigrator(
      (m) => m<{ id: string; updated_at: Date }[]>`
        select id, updated_at from opportunities where id = any(${all()}::uuid[]) order by id`,
    );
    const result = await run(all(), all());
    expect([...(result?.leads ?? [])].sort()).toEqual(anonymised().sort());
    expect(result).toMatchObject({ kept: KEPT.length, failed: 0, error: null });
    expect(await lastRun()).toEqual({ rows_affected: anonymised().length, error: null });
    // The kept leads are marked, and nothing else about them changed.
    const kept = await asMigrator(
      (m) => m<{ id: string; kept: boolean; updated_at: Date }[]>`
        select id, retention_kept_at is not null as kept, updated_at from opportunities
         where id = any(${all()}::uuid[]) order by id`,
    );
    for (const row of kept) {
      const isKept = KEPT.some((k) => leads[k].lead === row.id);
      expect({ id: row.id, kept: row.kept }).toEqual({ id: row.id, kept: isKept });
      if (isKept) {
        expect(row.updated_at).toEqual(before.find((b) => b.id === row.id)?.updated_at);
      }
    }

    const touched = await asMigrator(
      (m) => m<{ id: string; anonymised: boolean }[]>`
        select id, anonymised_at is not null as anonymised from opportunities
         where id = any(${all()}::uuid[])`,
    );
    expect(Object.fromEntries(touched.map((r) => [r.id, r.anonymised]))).toEqual(
      Object.fromEntries(all().map((lead) => [lead, anonymised().includes(lead)])),
    );
  });

  it('removes the personal details and keeps the facts', async () => {
    const lead = leads.stale;
    const [state] = await asMigrator(
      (m) => m<Record<string, unknown>[]>`
        select a.name as "accountName", a.gstin, a.archived_at is not null as "accountArchived",
               a.anonymised_at is not null as "accountAnonymised",
               c.name as "contactName", c.name_key as "nameKey", c.email,
               c.archived_at is not null as "contactArchived",
               (select count(*)::int from contact_phones where contact_id = c.id) as phones,
               s.address, s.village, s.village_key as "villageKey", s.pin, s.lat, s.lng,
               s.technical_json as technical, s.tehsil, s.district, s.state_code as "stateCode",
               s.archived_at is not null as "siteArchived",
               o.campaign_json as campaign, o.archived_at is not null as "leadArchived",
               o.state, o.account_id = a.id as "sameCustomer",
               (select count(*)::int from activities where account_id = a.id and type = 'note') as notes,
               (select count(*)::int from activities where account_id = a.id and type <> 'note') as "otherActivities",
               (select title from tasks where opportunity_id = o.id) as "taskTitle",
               (select count(*)::int from tasks where opportunity_id = o.id) as tasks,
               (select count(*)::int from calls where opportunity_id = o.id) as calls,
               (select count(*)::int from consents where contact_id = c.id) as consents,
               (select count(*)::int from account_entities where account_id = a.id) as companies,
               (select jsonb_agg(jsonb_build_object('raw', raw_json, 'normalised', normalised_json,
                                                    'state', state, 'createdId', created_id)
                                 order by row_no)
                  from import_rows where job_id = ${IMPORT_JOB}) as "importRows"
          from opportunities o
          join accounts a on a.id = o.account_id
          join account_contacts ac on ac.account_id = a.id
          join contacts c on c.id = ac.contact_id
          join customer_sites s on s.id = o.site_id
         where o.id = ${lead.lead}`,
    );
    expect(state).toEqual({
      accountName: '',
      gstin: null,
      accountArchived: true,
      accountAnonymised: true,
      contactName: '',
      nameKey: '',
      email: null,
      contactArchived: true,
      phones: 0,
      address: null,
      village: null,
      villageKey: null,
      pin: null,
      lat: null,
      lng: null,
      technical: {},
      // Coarse geography for reports stays.
      tehsil: 'retention tehsil',
      district: 'retention district',
      stateCode: '27',
      siteArchived: true,
      campaign: {},
      leadArchived: true,
      state: 'open',
      sameCustomer: true,
      notes: 0,
      otherActivities: 1,
      taskTitle: null,
      tasks: 1,
      calls: 1,
      consents: 1,
      companies: 1,
      importRows: [
        { raw: {}, normalised: null, state: 'committed', createdId: lead.lead },
        { raw: {}, normalised: null, state: 'skipped', createdId: null },
      ],
    });
  });

  it('leaves every other lead as it was', async () => {
    const kept = KINDS.filter((k) => !ELIGIBLE.includes(k));
    const found = await asMigrator(
      (m) => m<{ id: string; name: string; phones: number; notes: number; title: string | null }[]>`
        select o.id, a.name,
               (select count(*)::int from contact_phones p
                  join account_contacts ac on ac.contact_id = p.contact_id
                 where ac.account_id = a.id and p.id::text like ${`${P}%`}) as phones,
               (select count(*)::int from activities x
                 where x.account_id = a.id and x.type = 'note' and x.id::text like ${`${P}%`}
                   and x.created_at < '2002-01-01') as notes,
               (select title from tasks t where t.opportunity_id = o.id) as title
          from opportunities o join accounts a on a.id = o.account_id
         where o.id = any(${kept.map((k) => leads[k].lead)}::uuid[])`,
    );
    expect(found).toHaveLength(kept.length);
    for (const kind of kept) {
      const row = found.find((r) => r.id === leads[kind].lead);
      expect({ kind, ...row }).toEqual({
        kind,
        id: leads[kind].lead,
        name: `retention customer ${kind}`,
        phones: 1,
        notes: 1,
        title: `call ${kind} back`,
      });
    }
  });

  it('is idempotent: a second run finds nothing to do and changes nothing', async () => {
    const before = await asMigrator(
      (m) => m<{ id: string; updated_at: Date }[]>`
        select id, updated_at from opportunities where id = any(${all()}::uuid[]) order by id`,
    );
    const result = await run(all(), all());
    expect(result).toEqual({ leads: [], kept: 0, failed: 0, error: null });
    expect(await lastRun()).toEqual({ rows_affected: 0, error: null });
    const after = await asMigrator(
      (m) => m<{ id: string; updated_at: Date }[]>`
        select id, updated_at from opportunities where id = any(${all()}::uuid[]) order by id`,
    );
    expect(after).toEqual(before);
    const flags = await staleFlags();
    for (const kind of ELIGIBLE) expect(flags[leads[kind].lead]).toBeUndefined();
  });
});

describe('nothing of the person is left', () => {
  it('finds the marker and the phone number nowhere but in the kept consent evidence', async () => {
    // Every text, character and json column of every table, partitions read through their parent.
    const columns = await asMigrator(
      (m) => m<{ table: string; column: string }[]>`
        select c.table_name as table, c.column_name as column
          from information_schema.columns c
          join information_schema.tables t
            on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
           and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY')
         order by 1, 2`,
    );
    expect(columns.length).toBeGreaterThan(100);
    const hits: string[] = [];
    await asMigrator(async (m) => {
      for (const { table, column } of columns) {
        const [row] = await m.unsafe<{ n: number }[]>(
          `select count(*)::int as n from public."${table}"
            where "${column}"::text like '%' || $1 || '%' or "${column}"::text like '%' || $2 || '%'`,
          [MARK, MARK_DIGITS],
        );
        if ((row?.n ?? 0) > 0) hits.push(`${table}.${column}`);
      }
    });
    // The consent's signed form is kept as proof of consent, with its file name.
    expect(hits).toEqual(['files.name']);
    const [evidence] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from files where name like ${`%${MARK}%`} and id = ${EVIDENCE_FILE}`,
    );
    expect(evidence?.n).toBe(1);
  }, 120_000);
});

describe('the append-only exceptions open only for the anonymisation', () => {
  it('refuses a note’s removal to a request, and to the owner outside the anonymisation, whatever it sets', async () => {
    const note = leads.recentNote;
    expect(
      await failure(
        asPrincipal(principalFor('executive'), async ({ tx }) => {
          await tx.execute(sql`select set_config('app.lead_anonymise', ${note.account}, true)`);
          await tx.execute(sql`delete from activities where account_id = ${note.account}::uuid`);
        }),
      ),
    ).toMatch(/permission denied/);
    expect(
      await failure(
        asMigrator((m) =>
          m.begin(async (tx) => {
            await tx`select set_config('app.lead_anonymise', ${note.account}, true)`;
            await tx`delete from activities where account_id = ${note.account} and type = 'note'`;
          }),
        ),
      ),
    ).toMatch(/append-only/);
  });

  it('refuses a change to an agent’s proposal outside the anonymisation, and a request may not name its scope', async () => {
    expect(
      await failure(
        asMigrator(
          (m) => m`update agent_actions set input_json = input_json - 'pipelineKey'
                    where id = ${AGENT_ACTION}`,
        ),
      ),
    ).toMatch(/changes only its decision/);
    expect(
      await failure(
        asPrincipal(principalFor('executive'), ({ tx }) =>
          tx.execute(
            sql`insert into app.lead_anonymise_scope (tx, account_id) values (pg_current_xact_id(), ${leads.recentNote.account}::uuid)`,
          ),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe('the audit trail of an anonymised customer (owner, 13-10-2026)', () => {
  it('keeps every row, action, actor and record, and no personal value', async () => {
    const found = await asMigrator(
      (m) => m<{ id: string; command: string; aggregate_id: string | null; input: unknown; after: unknown }[]>`
        select id, command, aggregate_id, input_json as input, after_json as after
          from audit_logs where id in (${AUDIT.staleLead}, ${AUDIT.staleNote}, ${AUDIT.keptLead})`,
    );
    const byId = Object.fromEntries(found.map((r) => [r.id, r]));
    expect(byId[AUDIT.staleLead]).toEqual({
      id: AUDIT.staleLead,
      command: 'crm.lead.create',
      aggregate_id: leads.stale.lead,
      input: {
        entityId: 'removed',
        contact: { name: 'removed', phone: 'removed' },
        site: { village: 'removed' },
      },
      after: { accountId: leads.stale.account, score: 'removed', consent: null },
    });
    expect(byId[AUDIT.staleNote]).toMatchObject({
      command: 'crm.note.add',
      input: { entityId: 'removed', accountId: leads.stale.account, body: 'removed' },
    });
    // A kept customer's history is left as it was.
    expect(byId[AUDIT.keptLead]).toMatchObject({
      input: { entityId: 1, contact: { name: 'retention person qualified' } },
    });
  });

  it('refuses any change to an audit row outside the anonymisation, even the same blanking', async () => {
    expect(
      await failure(
        asMigrator(
          (m) => m`update audit_logs set input_json = app.audit_blank(input_json)
                    where id = ${AUDIT.keptLead}`,
        ),
      ),
    ).toMatch(/append-only/);
    expect(
      await failure(asMigrator((m) => m`delete from audit_logs where id = ${AUDIT.keptLead}`)),
    ).toMatch(/append-only/);
  });
});

describe('no write lands on an anonymised customer', () => {
  it('refuses a new task, note, lead or site for a customer already anonymised', async () => {
    const lead = leads.stale;
    const writes: ((m: postgres.Sql) => Promise<unknown>)[] = [
      (m) => m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind,
                                  due_at, created_by)
               values (${randomUUID()}, 1, ${lead.lead}, ${lead.account}, ${ACTOR}, 'callback',
                       now(), ${ACTOR})`,
      (m) => m`insert into activities (id, entity_id, opportunity_id, account_id, type,
                                       actor_principal_id, body)
               values (${randomUUID()}, 1, null, ${lead.account}, 'note', ${ACTOR}, 'called again')`,
      (m) => m`insert into customer_sites (id, account_id, type, village, created_by)
               values (${randomUUID()}, ${lead.account}, 'borewell', 'again', ${ACTOR})`,
      (m) => m`update customer_sites set village = 'again' where id = ${lead.site}`,
    ];
    for (const write of writes) {
      expect(await failure(asMigrator(write))).toMatch(/details were removed by the retention rule/);
    }
  });

  it('makes a write that started before the anonymisation wait for it, then refuses it', async () => {
    // The race the job closes: one session holds the customer as the job does and marks it
    // anonymised; a note written meanwhile waits for it, then sees the result and is refused.
    const account = randomUUID();
    await asMigrator(
      (m) => m`insert into accounts (id, type, name, created_by)
               values (${account}, 'farm', 'retention raced customer', ${ACTOR})`,
    );
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    const job = asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`select id from accounts where id = ${account} for update`;
        await tx`update accounts set anonymised_at = now() where id = ${account}`;
        held();
        await gate;
      }),
    );
    await holding;
    const write = failure(
      asMigrator(
        (m) => m`insert into activities (id, entity_id, opportunity_id, account_id, type,
                                         actor_principal_id, body)
                 values (${randomUUID()}, 1, null, ${account}, 'note', ${ACTOR}, 'written meanwhile')`,
      ),
    );
    // The write is waiting on the job's lock, not done.
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await job;
    expect(await write).toMatch(/details were removed by the retention rule/);
  });
});
