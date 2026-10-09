// Synthetic rows for the role × company visibility matrix (docs/07-security.md §11 item 1), written
// with the migrator connection: for every company one row in each table of ENTITY_TABLES, one
// customer shared by companies 1 and 2 (ADR 0008), and the group-wide rows (`entity_id null`) of
// the tables that allow them. Fixed ids so the fixture is re-creatable, except the audit rows,
// and the timeline rows, which are append-only and get new ids each run. Values are test data,
// never copy.
// `user_entity_roles` is the one table whose policy also shows the caller's own rows in any
// company (0049), so the owner holds a role in every company, as does a second person.
import { AGENT_PRINCIPAL_IDS, newId } from '@shakti/contracts';
import { ALL_ENTITY_IDS } from '../../seeds/entities';
import { PIPELINE_SEED, stageId } from '../../seeds/pipelines';
import { tierId } from '../../seeds/price-tiers';
import { roleId } from '../../seeds/roles';
import { asMigrator, type ENTITY_TABLES } from './index';

/** Prefix for fixture ids; four hex characters follow. */
export const ENTITY_MATRIX_FIXTURE_PREFIX = '01990000-0000-7000-8000-0000000b';
const P = ENTITY_MATRIX_FIXTURE_PREFIX;
const id = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;

const OWNER_ID = id(0x0001);
/** Names no audit row, so unlike the owner it is removed with the fixture. */
const OTHER_USER_ID = id(0x0007);
const MATRIX_ROLE = roleId('tele_caller_cc');

/** The command the fixture's audit rows carry, so a reader can tell them from real ones. */
export const ENTITY_MATRIX_AUDIT_COMMAND = 'test.entity_matrix';

export type EntityTable = (typeof ENTITY_TABLES)[number];

/**
 * Shared reference tables that allow `entity_id null` for the whole group (docs/05-database.md §1)
 * beside rows of one company. `teams` is the fourth, and sits in ENTITY_TABLES.
 */
export const GROUP_WIDE_SHARED_TABLES = [
  'pipelines',
  'pipeline_stages',
  'price_lists',
  'call_dispositions',
  'lead_score_rules',
] as const;
export type GroupWideSharedTable = (typeof GROUP_WIDE_SHARED_TABLES)[number];

export type MatrixTable = EntityTable | GroupWideSharedTable;

/**
 * How a row of each table is named in the matrix, as SQL over the alias `x`. Most tables have an
 * `id`; `account_contacts` and `import_rows` have composite keys.
 */
export const MATRIX_ROW_KEY: Record<MatrixTable, string> = {
  entities: 'x.id::text',
  teams: 'x.id::text',
  contacts: 'x.id::text',
  contact_phones: 'x.id::text',
  accounts: 'x.id::text',
  account_entities: 'x.id::text',
  account_contacts: "x.account_id::text || '/' || x.contact_id::text",
  customer_sites: 'x.id::text',
  opportunities: 'x.id::text',
  sizings: 'x.id::text',
  calls: 'x.id::text',
  quotes: 'x.id::text',
  quote_lines: 'x.id::text',
  quote_versions: 'x.id::text',
  sales_orders: 'x.id::text',
  sales_order_lines: 'x.id::text',
  dealer_terms: 'x.id::text',
  dealer_outstanding: 'x.id::text',
  commission_accruals: 'x.id::text',
  consents: 'x.id::text',
  item_costs: 'x.id::text',
  document_sequences: 'x.id::text',
  audit_logs: 'x.id::text',
  files: 'x.id::text',
  import_mapping_templates: 'x.id::text',
  import_jobs: 'x.id::text',
  import_rows: "x.job_id::text || '/' || x.row_no::text",
  user_entity_roles: 'x.id::text',
  activities: 'x.id::text',
  tasks: 'x.id::text',
  tags: 'x.id::text',
  opportunity_tags: "x.opportunity_id::text || '/' || x.tag_id::text",
  agent_configs: 'x.id::text',
  agent_runs: 'x.id::text',
  agent_actions: 'x.id::text',
  inbox_items: 'x.id::text',
  knowledge_files: 'x.id::text',
  knowledge_chunks: 'x.id::text',
  notifications: 'x.id::text',
  targets: 'x.id::text',
  pipelines: 'x.id::text',
  pipeline_stages: 'x.id::text',
  price_lists: 'x.id::text',
  call_dispositions: 'x.id::text',
  lead_score_rules: 'x.id::text',
  referral_partners: 'x.account_id::text',
  duplicate_candidates: 'x.id::text',
  customer_merges: 'x.id::text',
};

/** One fixture row: its key as MATRIX_ROW_KEY renders it, and the companies it belongs to. */
export interface MatrixRow {
  key: string;
  /** The companies whose members may see the row; `null` for a group-wide row. */
  entities: readonly number[] | null;
  /**
   * The row is the acting principal's own (the matrix acts as `ownerId`), which a table's
   * `ownRows` rule shows in any company.
   */
  ownedByActor?: true;
  /**
   * For a customer row, the companies where the customer has a lead (0057): whoever reads one of
   * those leads reads the row, acting in that company.
   */
  leadIn?: readonly number[];
  /**
   * A timeline row on a lead: whoever reads the lead reads the row, agents included, in place of
   * the table's `read` rule.
   */
  onLead?: true;
  /** For a `files` row, its purpose, which names who reads it (`app.file_purpose_grant()`). */
  purpose?: string;
  /** A row of another person's own (a notice), which nobody acting as the owner reads. */
  othersOwn?: true;
  /**
   * A dealer's order without a lead, or its line: read with the customer in its company rather
   * than with a lead (the table's `readRow`).
   */
  withCustomer?: true;
}

export interface EntityMatrixFixture {
  /**
   * A `principals` and `users` row that owns every CRM fixture row and holds a role in every
   * company; the matrix acts as this principal.
   */
  ownerId: string;
  /** A second person with a role in every company, whose rows the owner sees only in context. */
  otherUserId: string;
  /** The owner's team in each company, which owns that company's CRM fixture rows. */
  teamIds: Readonly<Record<number, string>>;
  rows: Readonly<Record<MatrixTable, readonly MatrixRow[]>>;
}

/**
 * Removes every fixture row but the audit rows (append-only) and the owner's `principals` row
 * they name.
 */
export async function removeEntityMatrixFixture(): Promise<void> {
  const like = `${P}%`;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      // Orders and their commission first: they name a quote, a lead and a commission rule.
      await tx`alter table commission_accruals disable trigger commission_accruals_guard`;
      await tx`delete from commission_accruals where id::text like ${like}`;
      await tx`alter table commission_accruals enable trigger commission_accruals_guard`;
      await tx`delete from commission_rules where id::text like ${like}`;
      await tx`alter table dealer_terms disable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding disable trigger dealer_outstanding_append_only`;
      await tx`alter table sales_order_lines disable trigger sales_order_lines_append_only`;
      await tx`delete from dealer_terms where id::text like ${like}`;
      await tx`delete from dealer_outstanding where id::text like ${like}`;
      await tx`delete from sales_order_lines where id::text like ${like}`;
      await tx`delete from sales_orders where id::text like ${like}`;
      await tx`alter table dealer_terms enable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding enable trigger dealer_outstanding_append_only`;
      await tx`alter table sales_order_lines enable trigger sales_order_lines_append_only`;
      // Quotes next: they name the company's price list, a lead and the item's rate.
      await tx`alter table quote_lines disable trigger quote_lines_append_only`;
      await tx`alter table quote_versions disable trigger quote_versions_append_only`;
      await tx`delete from quote_versions where id::text like ${like}`;
      await tx`delete from quote_lines where id::text like ${like}`;
      await tx`delete from quotes where id::text like ${like}`;
      await tx`alter table quote_lines enable trigger quote_lines_append_only`;
      await tx`alter table quote_versions enable trigger quote_versions_append_only`;
      await tx`delete from tax_rates where id::text like ${like}`;
      // Agent runs and actions are append-only and keep new ids each run, as audit rows do; the
      // inbox items naming them are removed, so no screen shows a fixture's suggestion.
      await tx`delete from inbox_items where id::text like ${like}`;
      await tx`delete from notifications where id::text like ${like}`;
      await tx`alter table targets disable trigger targets_append_only`;
      await tx`delete from targets where id::text like ${like}`;
      await tx`alter table targets enable trigger targets_append_only`;
      await tx`delete from agent_configs where id::text like ${like}`;
      await tx`delete from user_entity_roles where id::text like ${like}`;
      await tx`delete from users where id::text like ${like}`;
      await tx`delete from import_rows where job_id::text like ${like}`;
      await tx`delete from import_jobs where id::text like ${like}`;
      await tx`delete from import_mapping_templates where id::text like ${like}`;
      await tx`delete from knowledge_chunks where id::text like ${like}`;
      await tx`delete from knowledge_files where id::text like ${like}`;
      await tx`delete from files where id::text like ${like}`;
      await tx`delete from item_costs where id::text like ${like}`;
      await tx`delete from items where id::text like ${like}`;
      await tx`delete from document_sequences where id::text like ${like}`;
      await tx`delete from customer_merges where id::text like ${like}`;
      await tx`delete from duplicate_candidates where id::text like ${like}`;
      await tx`delete from tasks where id::text like ${like}`;
      await tx`delete from opportunity_tags where opportunity_id::text like ${like}`;
      await tx`delete from tags where id::text like ${like}`;
      await tx`delete from consents where id::text like ${like}`;
      await tx`alter table sizings disable trigger sizings_append_only`;
      await tx`delete from sizings where id::text like ${like}`;
      await tx`alter table sizings enable trigger sizings_append_only`;
      await tx`alter table calls disable trigger calls_append_only`;
      await tx`delete from calls where id::text like ${like}`;
      await tx`alter table calls enable trigger calls_append_only`;
      await tx`delete from opportunities where id::text like ${like}`;
      await tx`delete from customer_sites where id::text like ${like}`;
      await tx`delete from account_contacts where account_id::text like ${like}`;
      await tx`delete from contact_phones where id::text like ${like}`;
      await tx`delete from account_entities where account_id::text like ${like}`;
      await tx`delete from referral_partners where account_id::text like ${like}`;
      await tx`delete from accounts where id::text like ${like}`;
      await tx`delete from contacts where id::text like ${like}`;
      await tx`delete from price_lists where id::text like ${like}`;
      await tx`delete from call_dispositions where id::text like ${like}`;
      await tx`delete from lead_score_rules where id::text like ${like}`;
      await tx`delete from pipeline_stages where id::text like ${like}`;
      await tx`delete from pipelines where id::text like ${like}`;
      await tx`delete from teams where id::text like ${like}`;
      await tx`delete from principals where id = ${OTHER_USER_ID}`;
    }),
  );
}

/**
 * Writes the fixture after removing a previous run's. Callers remove it again when done
 * (`removeEntityMatrixFixture`), because the group-wide pipelines and price lists would otherwise
 * show on the screens and queries the later suites check.
 */
export async function entityMatrixFixture(): Promise<EntityMatrixFixture> {
  await removeEntityMatrixFixture();

  const ownerId = OWNER_ID;
  const otherUserId = OTHER_USER_ID;
  const groupTeam = id(0x0002);
  const item = id(0x0003);
  const groupPipeline = id(0x0004);
  const groupStage = id(0x0005);
  const groupPriceList = id(0x0006);
  const groupOutcome = id(0x000a);
  const groupScoreRule = id(0x000b);
  // An item's own rate, so a fixture quote line has the rate row every line names.
  const itemRate = id(0x0009);
  const groupTag = id(0x0008);
  // The customer shared by companies 1 and 2 (ADR 0008).
  const shared = {
    account: id(0x0501),
    link1: id(0x0502),
    link2: id(0x0503),
    contact: id(0x0504),
    phone: id(0x0505),
    site: id(0x0506),
    consent: id(0x0507),
    // A lead in company 2 only: a reader of leads sees the customer acting in company 2, never
    // in company 1, where the customer has no lead.
    opportunity: id(0x0508),
  };
  const per = (e: number, offset: number): string => id((e << 8) | offset);
  const teamIds: Record<number, string> = {};
  for (const e of ALL_ENTITY_IDS) teamIds[e] = per(e, 0x01);

  const rows: Record<MatrixTable, MatrixRow[]> = {
    entities: [],
    teams: [{ key: groupTeam, entities: null }],
    contacts: [{ key: shared.contact, entities: [1, 2], leadIn: [2] }],
    contact_phones: [{ key: shared.phone, entities: [1, 2], leadIn: [2] }],
    accounts: [{ key: shared.account, entities: [1, 2], leadIn: [2] }],
    account_entities: [
      { key: shared.link1, entities: [1], leadIn: [] },
      { key: shared.link2, entities: [2], leadIn: [2] },
    ],
    account_contacts: [
      { key: `${shared.account}/${shared.contact}`, entities: [1, 2], leadIn: [2] },
    ],
    customer_sites: [{ key: shared.site, entities: [1, 2], leadIn: [2] }],
    opportunities: [{ key: shared.opportunity, entities: [2] }],
    sizings: [],
    calls: [],
    quotes: [],
    quote_lines: [],
    quote_versions: [],
    sales_orders: [],
    sales_order_lines: [],
    dealer_terms: [],
    dealer_outstanding: [],
    commission_accruals: [],
    consents: [{ key: shared.consent, entities: [1, 2], leadIn: [2] }],
    item_costs: [],
    document_sequences: [],
    audit_logs: [],
    files: [],
    import_mapping_templates: [],
    import_jobs: [],
    import_rows: [],
    user_entity_roles: [],
    activities: [],
    tasks: [],
    tags: [],
    opportunity_tags: [],
    agent_configs: [],
    agent_runs: [],
    agent_actions: [],
    inbox_items: [],
    knowledge_files: [],
    knowledge_chunks: [],
    notifications: [],
    targets: [],
    pipelines: [{ key: groupPipeline, entities: null }],
    pipeline_stages: [{ key: groupStage, entities: null }],
    price_lists: [{ key: groupPriceList, entities: null }],
    call_dispositions: [{ key: groupOutcome, entities: null }],
    lead_score_rules: [{ key: groupScoreRule, entities: null }],
    referral_partners: [{ key: shared.account, entities: [1, 2], leadIn: [2] }],
    duplicate_candidates: [],
    customer_merges: [],
  };
  const groupAudit = newId();
  rows.audit_logs.push({ key: groupAudit, entities: null });
  rows.tags.push({ key: groupTag, entities: null });
  const groupAgentConfig = id(0x0009);
  rows.agent_configs.push({ key: groupAgentConfig, entities: null });
  // A vault file of the whole group, stored in company 1, with one chunk: a reader of staff
  // knowledge sees both acting in any company; its upload stays company 1's.
  const groupVaultUpload = id(0x000c);
  const groupVaultFile = id(0x000d);
  const groupVaultChunk = id(0x000e);
  rows.knowledge_files.push({ key: groupVaultFile, entities: null });
  rows.knowledge_chunks.push({ key: groupVaultChunk, entities: null });
  rows.files.push({ key: groupVaultUpload, entities: [1], purpose: 'knowledge' });
  // The fixture's agent rows name an agent no other suite sets, so its settings change nothing.
  const MATRIX_AGENT = 'agent:orchestrator';
  const agentId = AGENT_PRINCIPAL_IDS[MATRIX_AGENT];

  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('pipeline seed missing');
  const firstStage = stageId(1, 1);
  const sha = 'f'.repeat(64);

  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into principals (id, kind, display_name)
        values (${ownerId}, 'user', 'entity matrix owner') on conflict (id) do nothing`;
      await tx`insert into principals (id, kind, display_name)
        values (${otherUserId}, 'user', 'entity matrix other user')`;
      await tx`insert into users (id, name, email) values
        (${ownerId}, 'entity matrix owner', 'entity-matrix-owner@shakti.test'),
        (${otherUserId}, 'entity matrix other user', 'entity-matrix-other@shakti.test')`;
      await tx`insert into teams (id, entity_id, name) values (${groupTeam}, null, 'matrix group team')`;
      await tx`insert into tags (id, entity_id, name, created_by) values (${groupTag}, null, 'matrix group tag', ${ownerId})`;
      await tx`insert into agent_configs (id, agent, action_type, entity_id, created_by)
        values (${groupAgentConfig}, ${MATRIX_AGENT}, null, null, ${ownerId})`;
      await tx`insert into items (id, sku, name, category, hsn, unit)
        values (${item}, 'FX-MATRIX', 'matrix item', 'pump', '8413', 'nos')`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
        values (${itemRate}, ${item}, 0.00, '2090-01-01', 'matrix')`;
      await tx`insert into pipelines (id, entity_id, key, name, segment)
        values (${groupPipeline}, null, 'matrix-group', 'matrix group pipeline', 'farmer_pumps')`;
      await tx`insert into pipeline_stages (id, pipeline_id, entity_id, key, name, position)
        values (${groupStage}, ${groupPipeline}, null, 'matrix-group', 'matrix group stage', 1)`;
      // Archived lists stay readable and sit outside the one-live-list-per-tier rule.
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
        values (${groupPriceList}, ${tierId('retail')}, null, 9000, '2090-01-01', now())`;
      await tx`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command, outcome)
        values (${groupAudit}, null, ${ownerId}, 'user', ${ENTITY_MATRIX_AUDIT_COMMAND}, 'ok')`;
      // A segment list, so it never meets the seeded group list's keys.
      await tx`insert into call_dispositions (id, entity_id, segment, key, code, label, next_action, position)
        values (${groupOutcome}, null, 'commercial_epc', 9, 'matrix_outcome', 'matrix outcome', 'retry', 9)`;
      await tx`insert into lead_score_rules (id, entity_id, factor, match_json, points, position, created_by)
        values (${groupScoreRule}, null, 'age_days', '{"minDays": 36500}'::jsonb, 1, 50, ${ownerId})`;
      await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
        values (${groupVaultUpload}, 1, 'knowledge', 'matrix', ${`matrix/${groupVaultUpload}`}, 'matrix file', 'application/pdf', 1, ${sha}, 'ready', ${ownerId})`;
      await tx`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, state, created_by)
        values (${groupVaultFile}, null, ${groupVaultUpload}, 'matrix group vault file', 'staff_ai_ok', 'pdf', 'indexed', ${ownerId})`;
      await tx`insert into knowledge_chunks (id, knowledge_file_id, entity_id, sensitivity, position, chunk_text, embedding)
        values (${groupVaultChunk}, ${groupVaultFile}, null, 'staff_ai_ok', 0, 'matrix group passage', array_fill(0.1::real, array[1024])::vector)`;

      for (const e of ALL_ENTITY_IDS) {
        const team = per(e, 0x01);
        const account = per(e, 0x02);
        const link = per(e, 0x03);
        const contact = per(e, 0x04);
        const phone = per(e, 0x05);
        const site = per(e, 0x06);
        const consent = per(e, 0x07);
        const opportunity = per(e, 0x08);
        const cost = per(e, 0x09);
        const sequence = per(e, 0x0a);
        const file = per(e, 0x0b);
        const template = per(e, 0x0c);
        const job = per(e, 0x0d);
        const pipelineE = per(e, 0x0e);
        const stageE = per(e, 0x0f);
        const priceList = per(e, 0x10);
        const ownerRole = per(e, 0x11);
        const task = per(e, 0x13);
        const tag = per(e, 0x14);
        const otherRole = per(e, 0x12);
        const outcome = per(e, 0x19);
        const scoreRule = per(e, 0x1a);
        const agentConfig = per(e, 0x1c);
        const inboxItem = per(e, 0x1d);
        // The owner's notice and another person's, about the company's lead.
        const ownNotice = per(e, 0x40);
        const othersNotice = per(e, 0x41);
        const agentRun = newId();
        const agentAction = newId();
        // One file of each purpose besides the import file, each read by its own rule.
        const purposeFiles = [
          ['quote_pdf', per(e, 0x13), 'application/pdf'],
          ['signed_quote', per(e, 0x14), 'image/jpeg'],
          ['entity_logo', per(e, 0x15), 'image/png'],
          ['letterhead', per(e, 0x16), 'image/png'],
          ['knowledge', per(e, 0x17), 'application/pdf'],
          ['consent_evidence', per(e, 0x18), 'image/jpeg'],
          ['print_proof', per(e, 0x19), 'application/pdf'],
        ] as const;
        // The company's vault file (staff knowledge) on its vault upload, with one chunk.
        const vaultFile = per(e, 0x42);
        const vaultChunk = per(e, 0x43);
        const sizing = per(e, 0x1b);
        const call = per(e, 0x30);
        const quote = per(e, 0x1c);
        const quoteLine = per(e, 0x1d);
        const quoteVersion = per(e, 0x1e);
        // An order of the quote (read with the lead) and a dealer's order without one (read with
        // the customer), a line of each, the customer's credit entries and a commission.
        const leadOrder = per(e, 0x31);
        const dealerOrder = per(e, 0x32);
        const leadOrderLine = per(e, 0x33);
        const dealerOrderLine = per(e, 0x34);
        const terms = per(e, 0x35);
        const outstanding = per(e, 0x36);
        // The owner's target, another person's and the team's.
        const ownTarget = per(e, 0x46);
        const othersTarget = per(e, 0x47);
        const teamTarget = per(e, 0x48);
        const commissionRule = per(e, 0x37);
        const commission = per(e, 0x38);
        // A second customer of the company with the first one's name, put forward as its
        // duplicate and merged into it: the candidate needs both customers, the merge the first.
        const twin = per(e, 0x22);
        const twinLink = per(e, 0x23);
        const candidate = per(e, 0x24);
        const merge = per(e, 0x25);
        // A second open lead of the company's customer, put forward with the first as one: read
        // by whoever reads both leads, agents included.
        const secondLead = per(e, 0x26);
        const leadPair = per(e, 0x27);
        const audit = newId();
        const customerRow = newId();
        const leadRow = newId();
        const only = [e];

        await tx`insert into teams (id, entity_id, name) values (${team}, ${e}, ${`matrix team ${e}`})`;
        await tx`insert into contacts (id, name, created_by) values (${contact}, ${`matrix contact ${e}`}, ${ownerId})`;
        await tx`insert into contact_phones (id, contact_id, e164, created_by)
          values (${phone}, ${contact}, ${`+9197000${(10000 + e).toString()}`}, ${ownerId})`;
        await tx`insert into accounts (id, type, name, created_by) values (${account}, 'farm', ${`matrix account ${e}`}, ${ownerId})`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
          values (${link}, ${account}, ${e}, ${ownerId}, ${team}, ${ownerId})`;
        await tx`insert into account_contacts (account_id, contact_id, role, created_by)
          values (${account}, ${contact}, 'owner', ${ownerId})`;
        await tx`insert into customer_sites (id, account_id, type, created_by) values (${site}, ${account}, 'borewell', ${ownerId})`;
        await tx`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
          values (${consent}, ${contact}, 'call', 'service', 'walk_in_form', 'v1', now(), ${ownerId})`;
        await tx`insert into opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id, owner_id, team_id, created_by)
          values (${opportunity}, ${e}, ${account}, ${site}, ${pipeline.id}, ${firstStage}, ${ownerId}, ${team}, ${ownerId})`;
        await tx`insert into sizings (id, entity_id, opportunity_id, site_id, kind, inputs_json, result_json, in_bounds, reasons_json, engine_version, created_by)
          values (${sizing}, ${e}, ${opportunity}, ${site}, 'rooftop', '{}'::jsonb, '{}'::jsonb, true, '[]'::jsonb, 'matrix', ${ownerId})`;
        // An outcome of the group's own list, which the seed always writes.
        await tx`insert into calls (id, entity_id, opportunity_id, caller_id, direction, number_series, disposition_id, attempt_no, started_at)
          select ${call}, ${e}, ${opportunity}, ${ownerId}, 'outbound', 'manual', d.id, 1, now()
            from call_dispositions d
           where d.entity_id is null and d.segment is null and d.archived_at is null
           order by d.position limit 1`;
        await tx`insert into item_costs (id, item_id, entity_id, moving_avg_cost, last_purchase_rate, as_of)
          values (${cost}, ${item}, ${e}, 100.0000, 110.0000, now())`;
        await tx`insert into document_sequences (id, entity_id, doc_type, fy, prefix)
          values (${sequence}, ${e}, 'challan', '2098-99', ${`MX${e.toString()}/C`})`;
        await tx`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command, outcome)
          values (${audit}, ${e}, ${ownerId}, 'user', ${ENTITY_MATRIX_AUDIT_COMMAND}, 'ok')`;
        await tx`insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id) values
          (${customerRow}, ${e}, null, ${account}, 'customer_updated', ${ownerId}),
          (${leadRow}, ${e}, ${opportunity}, ${account}, 'lead_created', ${ownerId})`;
        await tx`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, team_id, kind, due_at, created_by)
          values (${task}, ${e}, ${opportunity}, ${account}, ${ownerId}, ${team}, 'callback', now(), ${ownerId})`;
        await tx`insert into tags (id, entity_id, name, created_by)
          values (${tag}, ${e}, ${`matrix tag ${e.toString()}`}, ${ownerId})`;
        await tx`insert into opportunity_tags (opportunity_id, account_id, tag_id, entity_id, created_by)
          values (${opportunity}, ${account}, ${tag}, ${e}, ${ownerId})`;
        await tx`insert into agent_configs (id, agent, action_type, entity_id, created_by)
          values (${agentConfig}, ${MATRIX_AGENT}, null, ${e}, ${ownerId})`;
        await tx`insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type, outcome, request_id)
          values (${agentRun}, ${e}, ${MATRIX_AGENT}, ${agentId}, 'matrix', 'crm.task.create', 'proposed', 'matrix')`;
        await tx`insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json, autonomy, state, created_by)
          values (${agentAction}, ${e}, ${agentRun}, ${MATRIX_AGENT}, 'crm.task.create', '{}'::jsonb, 'suggest', 'proposed', ${agentId})`;
        await tx`insert into inbox_items (id, entity_id, kind, assignee_id, team_id, subject_type, subject_id, agent_action_id, created_by)
          values (${inboxItem}, ${e}, 'agent_suggestion', ${ownerId}, ${team}, 'opportunity', ${opportunity}, ${agentAction}, ${agentId})`;
        await tx`insert into notifications (id, user_id, entity_id, type, subject_type, subject_id, dedupe_key) values
          (${ownNotice}, ${ownerId}, ${e}, 'lead_assigned', 'opportunity', ${opportunity}, ${`matrix:${ownNotice}`}),
          (${othersNotice}, ${otherUserId}, ${e}, 'lead_assigned', 'opportunity', ${opportunity}, ${`matrix:${othersNotice}`})`;
        await tx`insert into targets (id, entity_id, scope, subject_id, team_id, metric, period, starts_on, value, set_by) values
          (${ownTarget}, ${e}, 'caller', ${ownerId}, ${team}, 'calls', 'day', '2026-01-01', 10, ${ownerId}),
          (${othersTarget}, ${e}, 'caller', ${otherUserId}, ${team}, 'calls', 'day', '2026-01-01', 12, ${ownerId}),
          (${teamTarget}, ${e}, 'team', ${team}, ${team}, 'calls', 'week', '2025-12-29', 80, ${ownerId})`;
        await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, created_by)
          values (${file}, ${e}, 'import', 'matrix', ${`matrix/${file}`}, 'matrix.csv', 'text/csv', 1, ${sha}, ${ownerId})`;
        for (const [purpose, fileId, type] of purposeFiles) {
          await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
            values (${fileId}, ${e}, ${purpose}, 'matrix', ${`matrix/${fileId}`}, 'matrix file', ${type}, 1, ${sha}, 'ready', ${ownerId})`;
        }
        await tx`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, state, created_by)
          values (${vaultFile}, ${e}, ${per(e, 0x17)}, ${`matrix vault file ${e.toString()}`}, 'staff_ai_ok', 'pdf', 'indexed', ${ownerId})`;
        await tx`insert into knowledge_chunks (id, knowledge_file_id, entity_id, sensitivity, position, chunk_text, embedding)
          values (${vaultChunk}, ${vaultFile}, ${e}, 'staff_ai_ok', 0, 'matrix passage', array_fill(0.1::real, array[1024])::vector)`;
        await tx`insert into import_mapping_templates (id, entity_id, kind, name, mapping_json, created_by)
          values (${template}, ${e}, 'leads', 'matrix template', '{}'::jsonb, ${ownerId})`;
        await tx`insert into import_jobs (id, entity_id, kind, file_id, template_id, format, columns_json, created_by)
          values (${job}, ${e}, 'leads', ${file}, ${template}, 'csv', '[]'::jsonb, ${ownerId})`;
        await tx`insert into import_rows (job_id, entity_id, row_no, raw_json, created_by)
          values (${job}, ${e}, 1, '{}'::jsonb, ${ownerId})`;
        await tx`insert into pipelines (id, entity_id, key, name, segment)
          values (${pipelineE}, ${e}, ${`matrix-${e.toString()}`}, ${`matrix pipeline ${e}`}, 'farmer_pumps')`;
        await tx`insert into pipeline_stages (id, pipeline_id, entity_id, key, name, position)
          values (${stageE}, ${pipelineE}, ${e}, ${`matrix-${e.toString()}`}, ${`matrix stage ${e}`}, 1)`;
        await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
          values (${priceList}, ${tierId('dealer')}, ${e}, 9000, '2090-01-01', now())`;
        await tx`insert into call_dispositions (id, entity_id, segment, key, code, label, next_action, position)
          values (${outcome}, ${e}, 'commercial_epc', 9, 'matrix_outcome', 'matrix outcome', 'retry', 9)`;
        // Matches no lead: a lead would need to be a hundred years old.
        await tx`insert into lead_score_rules (id, entity_id, factor, match_json, points, position, created_by)
          values (${scoreRule}, ${e}, 'age_days', '{"minDays": 36500}'::jsonb, 1, 50, ${ownerId})`;
        // After the company's price list, which the quote names.
        await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, site_id, tier_id,
                   price_list_id, scheme, place_of_supply_state, supply_kind, valid_until, subtotal, cgst,
                   sgst, igst, tax_total, round_off, grand_total, created_by)
          values (${quote}, ${e}, ${`MX${e.toString()}/Q/2098-99/0001`}, '2098-99', ${opportunity}, ${account},
                  ${site}, ${tierId('dealer')}, ${priceList}, 'none', '08', 'intra', now() + interval '15 days',
                  0, 0, 0, 0, 0, 0, 0, ${ownerId})`;
        await tx`insert into quote_lines (id, entity_id, quote_id, position, item_id, sku, description, unit, qty,
                   unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value, cgst, sgst, igst, line_total)
          values (${quoteLine}, ${e}, ${quote}, 1, ${item}, 'FX-MATRIX', 'matrix item', 'nos', 1, 0, '8413',
                  ${itemRate}, 0.00, 0, 0, 0, 0, 0)`;
        await tx`insert into quote_versions (id, entity_id, quote_id, version, snapshot_json, created_by)
          values (${quoteVersion}, ${e}, ${quote}, 1, '{}'::jsonb, ${ownerId})`;
        await tx`insert into referral_partners (account_id, code, created_by)
          values (${account}, ${`MX${e.toString()}PARTNER`}, ${ownerId})`;
        await tx`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id, site_id,
                   tier_id, price_list_id, place_of_supply_state, supply_kind, subtotal, cgst, sgst, igst,
                   tax_total, round_off, grand_total, created_by)
          values (${leadOrder}, ${e}, ${`MX${e.toString()}/SO/2098-99/0001`}, '2098-99', ${quote}, ${opportunity},
                  ${account}, ${site}, ${tierId('dealer')}, ${priceList}, '08', 'intra', 0, 0, 0, 0, 0, 0, 0,
                  ${ownerId}),
                 (${dealerOrder}, ${e}, ${`MX${e.toString()}/SO/2098-99/0002`}, '2098-99', null, null,
                  ${account}, null, ${tierId('dealer')}, ${priceList}, '08', 'intra', 0, 0, 0, 0, 0, 0, 0,
                  ${ownerId})`;
        await tx`insert into sales_order_lines (id, entity_id, sales_order_id, position, item_id, sku, description,
                   unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value, cgst, sgst, igst, line_total)
          values (${leadOrderLine}, ${e}, ${leadOrder}, 1, ${item}, 'FX-MATRIX', 'matrix item', 'nos', 1, 0,
                  '8413', ${itemRate}, 0.00, 0, 0, 0, 0, 0),
                 (${dealerOrderLine}, ${e}, ${dealerOrder}, 1, ${item}, 'FX-MATRIX', 'matrix item', 'nos', 1, 0,
                  '8413', ${itemRate}, 0.00, 0, 0, 0, 0, 0)`;
        await tx`insert into dealer_terms (id, entity_id, account_id, credit_limit, credit_days, created_by)
          values (${terms}, ${e}, ${account}, 1.00, 1, ${ownerId})`;
        await tx`insert into dealer_outstanding (id, entity_id, account_id, outstanding, as_of, entered_by)
          values (${outstanding}, ${e}, ${account}, 0, '2098-04-01', ${ownerId})`;
        // A rule of the company's partner far in the future, so it never prices a real order.
        await tx`insert into commission_rules (id, partner_id, basis, amount, effective_from, created_by)
          values (${commissionRule}, ${account}, 'fixed', 1.00, '2098-04-01', ${ownerId})`;
        await tx`insert into commission_accruals (id, entity_id, partner_id, opportunity_id, sales_order_id,
                   commission_rule_id, basis, rate, measure, amount, created_by)
          values (${commission}, ${e}, ${account}, ${opportunity}, ${leadOrder}, ${commissionRule}, 'fixed',
                  1.00, 1, 1.00, ${ownerId})`;
        await tx`insert into accounts (id, type, name, created_by) values (${twin}, 'farm', ${`matrix account ${e}`}, ${ownerId})`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
          values (${twinLink}, ${twin}, ${e}, ${ownerId}, ${team}, ${ownerId})`;
        await tx`insert into duplicate_candidates (id, entity_id, kind, account_id, other_account_id, reason, confidence, created_by)
          values (${candidate}, ${e}, 'customer', ${account}, ${twin}, 'name_village', 60, ${ownerId})`;
        await tx`insert into opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id, owner_id, team_id, created_by)
          values (${secondLead}, ${e}, ${account}, ${site}, ${pipeline.id}, ${firstStage}, ${ownerId}, ${team}, ${ownerId})`;
        await tx`insert into duplicate_candidates (id, entity_id, kind, opportunity_id, other_opportunity_id, reason, confidence, created_by)
          values (${leadPair}, ${e}, 'lead', ${opportunity}, ${secondLead}, 'phone', 95, ${ownerId})`;
        await tx`insert into customer_merges (id, entity_id, kept_account_id, merged_account_id, moved_json, created_by)
          values (${merge}, ${e}, ${account}, ${twin}, '{}'::jsonb, ${ownerId})`;
        await tx`insert into user_entity_roles (id, user_id, entity_id, role_id, team_id, created_by) values
          (${ownerRole}, ${ownerId}, ${e}, ${MATRIX_ROLE}, ${team}, ${ownerId}),
          (${otherRole}, ${otherUserId}, ${e}, ${MATRIX_ROLE}, null, ${ownerId})`;

        rows.entities.push({ key: e.toString(), entities: only });
        rows.teams.push({ key: team, entities: only });
        rows.contacts.push({ key: contact, entities: only, leadIn: only });
        rows.contact_phones.push({ key: phone, entities: only, leadIn: only });
        rows.accounts.push(
          { key: account, entities: only, leadIn: only },
          { key: twin, entities: only, leadIn: [] },
        );
        rows.account_entities.push(
          { key: link, entities: only, leadIn: only },
          { key: twinLink, entities: only, leadIn: [] },
        );
        rows.duplicate_candidates.push(
          { key: candidate, entities: only, leadIn: [] },
          { key: leadPair, entities: only, onLead: true },
        );
        rows.opportunities.push({ key: secondLead, entities: only });
        rows.customer_merges.push({ key: merge, entities: only, leadIn: only });
        rows.account_contacts.push({ key: `${account}/${contact}`, entities: only, leadIn: only });
        rows.customer_sites.push({ key: site, entities: only, leadIn: only });
        rows.opportunities.push({ key: opportunity, entities: only });
        rows.sizings.push({ key: sizing, entities: only });
        rows.calls.push({ key: call, entities: only });
        rows.quotes.push({ key: quote, entities: only });
        rows.quote_lines.push({ key: quoteLine, entities: only });
        rows.quote_versions.push({ key: quoteVersion, entities: only });
        rows.sales_orders.push(
          { key: leadOrder, entities: only },
          { key: dealerOrder, entities: only, leadIn: only, withCustomer: true },
        );
        rows.sales_order_lines.push(
          { key: leadOrderLine, entities: only },
          { key: dealerOrderLine, entities: only, leadIn: only, withCustomer: true },
        );
        rows.dealer_terms.push({ key: terms, entities: only, leadIn: only });
        rows.dealer_outstanding.push({ key: outstanding, entities: only, leadIn: only });
        rows.commission_accruals.push({ key: commission, entities: only });
        rows.consents.push({ key: consent, entities: only, leadIn: only });
        rows.item_costs.push({ key: cost, entities: only });
        rows.document_sequences.push({ key: sequence, entities: only });
        rows.audit_logs.push({ key: audit, entities: only });
        rows.files.push({ key: file, entities: only, purpose: 'import' });
        for (const [purpose, fileId] of purposeFiles) {
          rows.files.push({ key: fileId, entities: only, purpose });
        }
        rows.import_mapping_templates.push({ key: template, entities: only });
        rows.import_jobs.push({ key: job, entities: only });
        rows.import_rows.push({ key: `${job}/1`, entities: only });
        rows.pipelines.push({ key: pipelineE, entities: only });
        rows.pipeline_stages.push({ key: stageE, entities: only });
        rows.price_lists.push({ key: priceList, entities: only });
        rows.call_dispositions.push({ key: outcome, entities: only });
        rows.lead_score_rules.push({ key: scoreRule, entities: only });
        rows.referral_partners.push({ key: account, entities: only, leadIn: only });
        rows.tasks.push({ key: task, entities: only });
        rows.tags.push({ key: tag, entities: only });
        rows.opportunity_tags.push({ key: `${opportunity}/${tag}`, entities: only });
        rows.agent_configs.push({ key: agentConfig, entities: only });
        rows.agent_runs.push({ key: agentRun, entities: only });
        rows.agent_actions.push({ key: agentAction, entities: only });
        rows.inbox_items.push({ key: inboxItem, entities: only });
        rows.knowledge_files.push({ key: vaultFile, entities: only });
        rows.knowledge_chunks.push({ key: vaultChunk, entities: only });
        rows.targets.push(
          { key: ownTarget, entities: only },
          { key: othersTarget, entities: only, othersOwn: true },
          { key: teamTarget, entities: only },
        );
        rows.notifications.push(
          { key: ownNotice, entities: only },
          { key: othersNotice, entities: only, othersOwn: true },
        );
        rows.activities.push(
          { key: customerRow, entities: only, leadIn: only },
          { key: leadRow, entities: only, onLead: true },
        );
        rows.user_entity_roles.push(
          { key: ownerRole, entities: only, ownedByActor: true },
          { key: otherRole, entities: only },
        );
      }

      // The shared customer: one account, contact and site, related to companies 1 and 2.
      const team1 = teamIds[1] ?? '';
      const team2 = teamIds[2] ?? '';
      await tx`insert into contacts (id, name, created_by) values (${shared.contact}, 'matrix shared contact', ${ownerId})`;
      await tx`insert into contact_phones (id, contact_id, e164, created_by)
        values (${shared.phone}, ${shared.contact}, '+919700020000', ${ownerId})`;
      await tx`insert into accounts (id, type, name, created_by) values (${shared.account}, 'farm', 'matrix shared account', ${ownerId})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by) values
        (${shared.link1}, ${shared.account}, 1, ${ownerId}, ${team1}, ${ownerId}),
        (${shared.link2}, ${shared.account}, 2, ${ownerId}, ${team2}, ${ownerId})`;
      await tx`insert into account_contacts (account_id, contact_id, role, created_by)
        values (${shared.account}, ${shared.contact}, 'owner', ${ownerId})`;
      await tx`insert into customer_sites (id, account_id, type, created_by) values (${shared.site}, ${shared.account}, 'rooftop', ${ownerId})`;
      await tx`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
        values (${shared.consent}, ${shared.contact}, 'call', 'service', 'walk_in_form', 'v1', now(), ${ownerId})`;
      await tx`insert into referral_partners (account_id, code, created_by)
        values (${shared.account}, 'MXSHARED', ${ownerId})`;
      await tx`insert into opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        values (${shared.opportunity}, 2, ${shared.account}, ${shared.site}, ${pipeline.id}, ${firstStage}, ${ownerId}, ${team2}, ${ownerId})`;
      // The shared customer's own row in company 1, where it has no lead.
      const sharedRow = newId();
      await tx`insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id)
        values (${sharedRow}, 1, null, ${shared.account}, 'customer_updated', ${ownerId})`;
      rows.activities.push({ key: sharedRow, entities: [1], leadIn: [] });
    }),
  );

  return { ownerId, otherUserId, teamIds, rows };
}
