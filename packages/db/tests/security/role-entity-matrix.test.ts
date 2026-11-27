import {
  hasGrant,
  type PermissionKey,
  type Principal,
  ROLE_KEYS,
  type RoleKey,
  type Scope,
} from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_ENTITY_IDS,
  asMigrator,
  asPrincipal,
  closeDb,
  ENTITY_TABLES,
  entityMatrixFixture,
  GROUP_WIDE_SHARED_TABLES,
  MATRIX_ROW_KEY,
  principalFor,
  removeEntityMatrixFixture,
  ROLE_SEED,
  type EntityMatrixFixture,
  type MatrixRow,
  type MatrixTable,
} from '../../src/testing/index';

/**
 * SECURITY §11 item 1: for every business table and every role acting in one company, only that
 * company's rows are visible. Every table in ENTITY_TABLES holds one fixture row per company;
 * the matrix acts as the rows' owner, in their team, so a role that holds the table's read
 * permission at any scope sees its own company's row, and a role without it sees nothing at all.
 * Beside the fixture rows, every row of the table is checked, whoever wrote it: none may belong
 * to another company. The customer master has no company of its own and is scoped through
 * `account_entities` (ADR 0008), whose rows a person, never an agent, also reads through a lead of
 * that customer they can read in the same company (0057); group-wide rows (`entity_id null`) are visible or not as their
 * table's policy says (docs/05-database.md §1, §4).
 */

type Rule =
  | { kind: 'context' }
  | { kind: 'grant'; key: PermissionKey; scope: Scope }
  | { kind: 'never' }
  | { kind: 'any'; rules: readonly Rule[] };

interface TableRule {
  /** Who sees a row of their own company. */
  read: Rule;
  /** For a table whose rows are read by different rules (a file by its purpose): the row's rule. */
  readRow?: (row: MatrixRow) => Rule;
  /** Who sees a group-wide row; absent where the table has none. */
  group?: Rule;
  /** Who sees their own rows (`ownedByActor`) in every company; absent where the table has none. */
  ownRows?: Rule;
  /**
   * For the customer master (0057): which people see a customer row through one of its leads in
   * the company they act in (`leadIn`), whatever their customer scope. Never an agent.
   */
  throughLead?: Rule;
  /** Who sees a row marked `onLead`, agents included, in place of `read`. */
  lead?: Rule;
  /** A visible row that breaks isolation for someone acting in company `e`, over the alias `x`. */
  leak: (e: number, groupVisible: boolean) => SQL;
}

const CONTEXT: Rule = { kind: 'context' };
const grant = (key: PermissionKey, scope: Scope): Rule => ({ kind: 'grant', key, scope });

// The matrix acts as each row's owner, in its team, so `own` is the narrowest scope that reads it.
const ACCOUNT_READ = grant('crm.account.read', 'own');
const LEAD_READ = grant('crm.lead.read', 'own');
const IMPORTS = grant('imports.write', 'entity');
const NEVER: Rule = { kind: 'never' };
/** Either agent control reads the runs and actions of the company (DATABASE §4.4). */
const AGENT_CONTROLS: Rule = {
  kind: 'any',
  rules: [grant('agents.autonomy.write', 'entity'), grant('agents.killswitch', 'entity')],
};
const INBOX = grant('agents.inbox.act', 'own');

/** U1: the vendor master's readers, and the supplier rates' (docs/03-roadmap-appendix/phase3.md §6.3). */
const VENDOR_READ: Rule = {
  kind: 'any',
  rules: [grant('inventory.stock.read', 'own'), grant('procurement.po.write', 'entity')],
};
const RATE_READ = grant('procurement.rate.read', 'entity');

/** A vault file and its chunks of staff knowledge, which every fixture row is (0123). */
const STAFF_KNOWLEDGE = grant('knowledge.vault.read.staff', 'all');

/** The conflict check's pairs, read by either playbook grant with their directive (0161). */
const PLAYBOOK_GRANTS: Rule = {
  kind: 'any',
  rules: [grant('knowledge.playbook.draft', 'all'), grant('knowledge.playbook.approve', 'all')],
};

/**
 * A file is read by its purpose (0062, `app.file_purpose_grant()`); the matrix acts as the file's
 * uploader, so `own` is the narrowest scope that reads one. A logo and a letterhead are read by
 * every principal of the company; a vault upload with its vault file, here staff knowledge, or by
 * its uploader while they hold `knowledge.vault.write` (0123).
 */
const FILE_PURPOSE_READ: Readonly<Record<string, Rule>> = {
  import: IMPORTS,
  quote_pdf: LEAD_READ,
  signed_quote: LEAD_READ,
  entity_logo: CONTEXT,
  letterhead: CONTEXT,
  knowledge: { kind: 'any', rules: [STAFF_KNOWLEDGE, grant('knowledge.vault.write', 'all')] },
  consent_evidence: grant('crm.account.write', 'own'),
  // A company's proof page prints its bank account: an Executive's alone.
  print_proof: grant('admin.entities.write', 'own'),
  // A call's recording is heard only through calls.recording.play, never read as a file.
  call_recording: NEVER,
  // A call's transcript is read with its call, so with the lead (0190).
  call_transcript: LEAD_READ,
  // U1: a supplier's quote document shows the rate.
  vendor_quote: RATE_READ,
};
/** The file checks' permission (`system:workers`) reads every file of the company as well. */
const fileRead = (purpose: string | undefined): Rule => ({
  kind: 'any',
  rules: [
    (purpose === undefined ? undefined : FILE_PURPOSE_READ[purpose]) ?? NEVER,
    grant('files.process', 'entity'),
  ],
});

/** A row of another company; a group-wide row too, unless the policy shows it. */
const otherCompany = (e: number, groupVisible: boolean): SQL =>
  groupVisible ? sql`x.entity_id <> ${e}` : sql`x.entity_id is distinct from ${e}`;

/** A customer row whose account has no relation with company `e`. */
const accountOutside =
  (column: string) =>
  (e: number): SQL =>
    sql`not exists (select 1 from account_entities ae
                     where ae.account_id = ${sql.raw(column)} and ae.entity_id = ${e})`;

/** A contact row none of whose accounts has a relation with company `e`. */
const contactOutside =
  (column: string) =>
  (e: number): SQL =>
    sql`not exists (select 1 from account_contacts ac
                      join account_entities ae on ae.account_id = ac.account_id
                     where ac.contact_id = ${sql.raw(column)} and ae.entity_id = ${e})`;

const RULES: Record<MatrixTable, TableRule> = {
  entities: { read: CONTEXT, leak: (e) => sql`x.id <> ${e}` },
  teams: { read: CONTEXT, group: CONTEXT, leak: otherCompany },
  contacts: { read: ACCOUNT_READ, throughLead: LEAD_READ, leak: contactOutside('x.id') },
  contact_phones: {
    read: ACCOUNT_READ,
    throughLead: LEAD_READ,
    leak: contactOutside('x.contact_id'),
  },
  accounts: { read: ACCOUNT_READ, throughLead: LEAD_READ, leak: accountOutside('x.id') },
  account_entities: { read: ACCOUNT_READ, throughLead: LEAD_READ, leak: otherCompany },
  account_contacts: {
    read: ACCOUNT_READ,
    throughLead: LEAD_READ,
    leak: accountOutside('x.account_id'),
  },
  customer_sites: {
    read: ACCOUNT_READ,
    throughLead: LEAD_READ,
    leak: accountOutside('x.account_id'),
  },
  opportunities: { read: grant('crm.lead.read', 'own'), leak: otherCompany },
  // A child of the lead: read with it.
  sizings: { read: LEAD_READ, leak: otherCompany },
  // A child of the lead: read with it.
  calls: { read: LEAD_READ, leak: otherCompany },
  // A quote, its lines and its versions are children of the lead: read with it.
  quotes: { read: LEAD_READ, leak: otherCompany },
  quote_lines: { read: LEAD_READ, leak: otherCompany },
  quote_versions: { read: LEAD_READ, leak: otherCompany },
  // An order of a quote, and its line, are read with the lead; a dealer's order without one,
  // and its line, with the customer in its company (S2).
  sales_orders: {
    read: LEAD_READ,
    readRow: (row) => (row.withCustomer === true ? ACCOUNT_READ : LEAD_READ),
    throughLead: LEAD_READ,
    leak: otherCompany,
  },
  sales_order_lines: {
    read: LEAD_READ,
    readRow: (row) => (row.withCustomer === true ? ACCOUNT_READ : LEAD_READ),
    throughLead: LEAD_READ,
    leak: otherCompany,
  },
  // A dealer's credit entries: by Accounts (sales.credit.write) and with the customer.
  dealer_terms: {
    read: { kind: 'any', rules: [ACCOUNT_READ, grant('sales.credit.write', 'entity')] },
    throughLead: LEAD_READ,
    leak: otherCompany,
  },
  dealer_outstanding: {
    read: { kind: 'any', rules: [ACCOUNT_READ, grant('sales.credit.write', 'entity')] },
    throughLead: LEAD_READ,
    leak: otherCompany,
  },
  // A commission is read as the commission rules are: the Executive and Accounts.
  commission_accruals: {
    read: {
      kind: 'any',
      rules: [grant('crm.config.write', 'all'), grant('finance.payment.write', 'own')],
    },
    leak: otherCompany,
  },
  consents: { read: ACCOUNT_READ, throughLead: LEAD_READ, leak: contactOutside('x.contact_id') },
  item_costs: { read: grant('finance.cost.read', 'entity'), leak: otherCompany },
  // H1: a company's serials, movements and balances with inventory.stock.read for the company (a
  // Field Engineer's own scope reads none); each movement's cost with finance.cost.read.
  serials: { read: grant('inventory.stock.read', 'entity'), leak: otherCompany },
  stock_movements: { read: grant('inventory.stock.read', 'entity'), leak: otherCompany },
  stock_movement_costs: { read: grant('finance.cost.read', 'entity'), leak: otherCompany },
  // R3: a company's claims with inventory.stock.read or inventory.warranty.write for the company;
  // their costs only with finance.cost.read.
  warranty_claims: {
    read: {
      kind: 'any',
      rules: [grant('inventory.stock.read', 'entity'), grant('inventory.warranty.write', 'entity')],
    },
    leak: otherCompany,
  },
  warranty_claim_costs: { read: grant('finance.cost.read', 'entity'), leak: otherCompany },
  stock_balances: { read: grant('inventory.stock.read', 'entity'), leak: otherCompany },
  document_sequences: { read: CONTEXT, leak: otherCompany },
  audit_logs: {
    read: grant('audit.read', 'entity'),
    group: grant('audit.read', 'all'),
    leak: otherCompany,
  },
  files: {
    read: IMPORTS,
    readRow: (row) => fileRead(row.purpose),
    // A supplier's quote document named by a group quote is read with that quote in any company
    // (0234, review M2): no leak of another company's file.
    leak: (e, groupVisible) =>
      sql`${otherCompany(e, groupVisible)} and not (x.purpose = 'vendor_quote' and exists (
            select 1 from vendor_quotes q
             where q.file_id = x.id and q.entity_id is null and q.withdrawn_at is null))`,
  },
  import_mapping_templates: { read: IMPORTS, leak: otherCompany },
  // The import worker (`system:workers`) reads a job of its company to stop it.
  import_jobs: {
    read: { kind: 'any', rules: [IMPORTS, grant('imports.process', 'entity')] },
    leak: otherCompany,
  },
  import_rows: { read: IMPORTS, leak: otherCompany },
  // 0049: every role reads the role map of the acting company, and its own roles in any company
  // (the profile and the company switcher), never another person's role in another company.
  user_entity_roles: {
    read: CONTEXT,
    ownRows: CONTEXT,
    leak: (e) => sql`x.entity_id <> ${e} and x.user_id <> ${fx.ownerId}`,
  },
  // A timeline row on a lead follows the lead; a row of no lead follows the customer (0057).
  activities: {
    read: ACCOUNT_READ,
    throughLead: LEAD_READ,
    lead: LEAD_READ,
    leak: otherCompany,
  },
  // The assignee is the task's owner; the matrix acts as the assignee, in their team.
  tasks: { read: LEAD_READ, leak: otherCompany },
  tags: { read: LEAD_READ, group: LEAD_READ, leak: otherCompany },
  opportunity_tags: { read: LEAD_READ, leak: otherCompany },
  // Every principal of a company reads its agent settings and the group's (DATABASE §4.4).
  agent_configs: { read: CONTEXT, group: CONTEXT, leak: otherCompany },
  agent_runs: { read: AGENT_CONTROLS, leak: otherCompany },
  // The fixture's suggestion is the owner's, in their team: the inbox reads it at own scope.
  agent_actions: {
    read: { kind: 'any', rules: [AGENT_CONTROLS, INBOX] },
    leak: otherCompany,
  },
  inbox_items: { read: INBOX, leak: otherCompany },
  knowledge_files: { read: STAFF_KNOWLEDGE, group: STAFF_KNOWLEDGE, leak: otherCompany },
  knowledge_chunks: { read: STAFF_KNOWLEDGE, group: STAFF_KNOWLEDGE, leak: otherCompany },
  // Every fixture directive is an approved one for staff, which every staff role reads.
  playbook_directives: { read: STAFF_KNOWLEDGE, group: STAFF_KNOWLEDGE, leak: otherCompany },
  playbook_conflict_checks: { read: PLAYBOOK_GRANTS, group: PLAYBOOK_GRANTS, leak: otherCompany },
  // A person's own notices in the company they act in, whatever their role; never another's.
  notifications: {
    read: CONTEXT,
    readRow: (row) => (row.othersOwn === true ? NEVER : CONTEXT),
    leak: otherCompany,
  },
  // A person's own Ask conversations and messages in the company they act in, whatever their
  // role; never another's, and never one covering several companies to someone acting in one.
  ask_conversations: {
    read: CONTEXT,
    readRow: (row) => (row.othersOwn === true ? NEVER : CONTEXT),
    group: NEVER,
    leak: otherCompany,
  },
  ask_messages: {
    read: CONTEXT,
    readRow: (row) => (row.othersOwn === true ? NEVER : CONTEXT),
    group: NEVER,
    leak: otherCompany,
  },
  // A person's own voice sessions; another person's only to the Executive (audit.read for the
  // group). A session over every company is read only in a request covering them all.
  voice_sessions: {
    read: CONTEXT,
    readRow: (row) => (row.othersOwn === true ? grant('audit.read', 'all') : CONTEXT),
    group: NEVER,
    leak: otherCompany,
  },
  // A caller's own target and their team's, whatever their role; another caller's only to a
  // holder of sales.targets.write over the team (a team lead), the company or the group.
  targets: {
    read: CONTEXT,
    readRow: (row) => (row.othersOwn === true ? grant('sales.targets.write', 'team') : CONTEXT),
    leak: otherCompany,
  },
  // A person's own caller profile, whatever their role; another person's to a manager of the
  // company, or to a team lead of their team (the fixture's other person is in the owner's team).
  caller_profiles: {
    read: CONTEXT,
    readRow: (row) => (row.othersOwn === true ? grant('crm.lead.assign', 'team') : CONTEXT),
    leak: otherCompany,
  },
  // A company's numbers: every principal acting in the company reads them (design phase2 §5.2).
  entity_channels: { read: CONTEXT, leak: otherCompany },
  // A WhatsApp thread and its messages are read under the customer's read rule, as Account 360;
  // one matched to no customer yet only with messaging.send for the company (design phase2 §6.1).
  whatsapp_threads: {
    read: ACCOUNT_READ,
    readRow: (row) => (row.unmatched === true ? grant('messaging.send', 'entity') : ACCOUNT_READ),
    throughLead: LEAD_READ,
    leak: otherCompany,
  },
  whatsapp_messages: {
    read: ACCOUNT_READ,
    readRow: (row) => (row.unmatched === true ? grant('messaging.send', 'entity') : ACCOUNT_READ),
    throughLead: LEAD_READ,
    leak: otherCompany,
  },
  // A company's templates: every principal acting in the company reads them (the composer).
  whatsapp_templates: { read: CONTEXT, leak: otherCompany },
  whatsapp_milestones: { read: CONTEXT, leak: otherCompany },
  // A company's connected forms and sites and its website keys: an Executive's (design phase2 §6.2).
  ingest_sources: { read: grant('crm.sources.write', 'all'), leak: otherCompany },
  ingest_keys: { read: grant('crm.sources.write', 'all'), leak: otherCompany },
  // A lead's qualification facts, read with the lead.
  lead_qualifications: { read: LEAD_READ, leak: otherCompany },
  // A provider's call is a child of the lead: read with it, as the call log is.
  provider_calls: { read: LEAD_READ, leak: otherCompany },
  // The Co-pilot's briefs and summaries are a child of the lead: read with it (design phase2 §7.3).
  copilot_notes: { read: LEAD_READ, leak: otherCompany },
  pipelines: { read: CONTEXT, group: CONTEXT, leak: otherCompany },
  pipeline_stages: { read: CONTEXT, group: CONTEXT, leak: otherCompany },
  price_lists: {
    read: grant('pricing.read', 'entity'),
    group: grant('pricing.read', 'entity'),
    leak: otherCompany,
  },
  // CRM set-up: every caller reads the group's rows and their own company's.
  call_dispositions: { read: CONTEXT, group: CONTEXT, leak: otherCompany },
  lead_score_rules: { read: CONTEXT, group: CONTEXT, leak: otherCompany },
  // A duplicate is read by whoever reads both customers (D1); the fixture's second customer has
  // no lead, so only customer scope reads it.
  // A customer pair needs both customers, a lead pair both leads (agents included).
  duplicate_candidates: {
    read: ACCOUNT_READ,
    throughLead: LEAD_READ,
    lead: LEAD_READ,
    leak: otherCompany,
  },
  // A merge is read with the customer it was merged into.
  customer_merges: { read: ACCOUNT_READ, throughLead: LEAD_READ, leak: otherCompany },
  // A referral partner is read with its customer (ADR 0008).
  referral_partners: {
    read: ACCOUNT_READ,
    throughLead: LEAD_READ,
    leak: accountOutside('x.account_id'),
  },
  // U1: the group's vendor master has no company, so no row of it is another company's; it is
  // read acting in any company with inventory.stock.read or procurement.po.write. A supplier
  // quote is read only with procurement.rate.read: the group's acting in any company, a company's
  // acting in that company (docs/03-roadmap-appendix/phase3.md §6.3).
  vendors: { read: VENDOR_READ, leak: () => sql`false` },
  vendor_contacts: { read: VENDOR_READ, leak: () => sql`false` },
  item_vendors: { read: VENDOR_READ, leak: () => sql`false` },
  vendor_quotes: { read: RATE_READ, group: RATE_READ, leak: otherCompany },
};

const TABLES = Object.keys(RULES) as MatrixTable[];
const ROLES: RoleKey[] = ROLE_SEED.map((r) => r.key);

function allows(principal: Principal, rule: Rule | undefined): boolean {
  if (rule === undefined || rule.kind === 'never') return false;
  if (rule.kind === 'any') return rule.rules.some((r) => allows(principal, r));
  return rule.kind === 'context' || hasGrant(principal.permissions, rule.key, rule.scope);
}

/**
 * The tables an agent reads at `own` scope only through the WhatsApp thread its run is bound to
 * (A3): the customer master and the leads, and every table read through them. For an agent, `own`
 * there is the bound thread's customer and lead, never rows it owns, and the matrix binds no
 * thread, so an agent's `own` grants read none of them (agent-thread-binding.test.ts reads them
 * bound).
 */
const THREAD_BOUND_FOR_AGENTS: ReadonlySet<MatrixTable> = new Set<MatrixTable>([
  'account_contacts',
  'account_entities',
  'accounts',
  'activities',
  'calls',
  'consents',
  'contact_phones',
  'contacts',
  // The Caller Co-pilot's notes, read with the lead (A2).
  'copilot_notes',
  'customer_merges',
  'customer_sites',
  'dealer_outstanding',
  'dealer_terms',
  'duplicate_candidates',
  'lead_qualifications',
  'opportunities',
  'opportunity_tags',
  'provider_calls',
  'quote_lines',
  'quote_versions',
  'quotes',
  'referral_partners',
  'sales_order_lines',
  'sales_orders',
  'sizings',
  'tasks',
  'whatsapp_messages',
  'whatsapp_threads',
]);

/** The principal as a table's policies read it: an agent unbound holds no `own` scope there. */
function readingAs(principal: Principal, table: MatrixTable): Principal {
  if (principal.kind !== 'agent' || !THREAD_BOUND_FOR_AGENTS.has(table)) return principal;
  return { ...principal, permissions: principal.permissions.filter((g) => g.scope !== 'own') };
}

const readRule = (rule: TableRule, row: MatrixRow): Rule => rule.readRow?.(row) ?? rule.read;

/**
 * The file purposes read through a lead (a call's transcript, with its call): for an agent, thread
 * bound like the tables above, so an unbound agent's `own` grants read none.
 */
const THREAD_BOUND_FILE_PURPOSES: ReadonlySet<string> = new Set(['call_transcript']);

/** The principal as a row's policy reads it: `readingAs`, and a thread-bound file's too. */
function readingRowAs(principal: Principal, table: MatrixTable, row: MatrixRow): Principal {
  if (
    principal.kind === 'agent' &&
    table === 'files' &&
    row.purpose !== undefined &&
    THREAD_BOUND_FILE_PURPOSES.has(row.purpose)
  ) {
    return readingAs(principal, 'accounts');
  }
  return readingAs(principal, table);
}

interface Seen {
  seen: string[];
  leaked: number;
  total: number;
}

/** What `principal` sees of `table`: which of `keys`, how many rows of another company, all rows. */
async function observe(
  principal: Principal,
  entityId: number,
  tables: readonly MatrixTable[],
  keysOf: (table: MatrixTable) => readonly string[],
): Promise<Map<MatrixTable, Seen>> {
  return asPrincipal(principal, async ({ tx }) => {
    const out = new Map<MatrixTable, Seen>();
    for (const table of tables) {
      const rule = RULES[table];
      const t = sql.identifier(table);
      const key = sql.raw(MATRIX_ROW_KEY[table]);
      const keys = keysOf(table).join(',');
      const [row] = (await tx.execute(sql`
        select (select coalesce(array_agg(s.k), '{}') from (select ${key} as k from ${t} x) s
                 where s.k = any(string_to_array(${keys}, ','))) as seen,
               (select count(*)::int from ${t} x
                 where ${rule.leak(entityId, allows(readingAs(principal, table), rule.group))}) as leaked,
               (select count(*)::int from ${t}) as total`)) as unknown as Seen[];
      if (!row) throw new Error(`no answer for ${table}`);
      out.set(table, { ...row, seen: [...row.seen].sort() });
    }
    return out;
  });
}

let fx: EntityMatrixFixture;

beforeAll(async () => {
  fx = await entityMatrixFixture();
});

afterAll(async () => {
  await removeEntityMatrixFixture();
  await closeDb();
});

const actingIn = (role: RoleKey, entityId: number): Principal =>
  principalFor(role, [entityId], { id: fx.ownerId, teamId: fx.teamIds[entityId] });

describe('every role acting in one company sees only that company (SECURITY §11 item 1)', () => {
  it('has a rule for every table in ENTITY_TABLES and every group-wide shared table, and every seeded role', () => {
    expect([...TABLES].sort()).toEqual([...ENTITY_TABLES, ...GROUP_WIDE_SHARED_TABLES].sort());
    expect(Object.keys(MATRIX_ROW_KEY).sort()).toEqual([...TABLES].sort());
    expect([...ROLES].sort()).toEqual([...ROLE_KEYS].sort());
  });

  it('has a fixture row in every company for every table in ENTITY_TABLES', () => {
    for (const table of TABLES) {
      const missing = ALL_ENTITY_IDS.filter(
        (e) => !fx.rows[table].some((r) => r.entities?.includes(e) === true),
      );
      expect({ table, missing }).toEqual({ table, missing: [] });
    }
    for (const table of TABLES) {
      const groupWide = fx.rows[table].some((r) => r.entities === null);
      expect({ table, groupWide }).toEqual({ table, groupWide: RULES[table].group !== undefined });
    }
    // A table whose policy shows the caller's own rows holds, in every company, one of the
    // actor's rows and one of someone else's, so both halves of the policy are observed.
    for (const table of TABLES) {
      const own = fx.rows[table].filter((r) => r.ownedByActor === true);
      if (RULES[table].ownRows === undefined) {
        expect({ table, own: own.length }).toEqual({ table, own: 0 });
        continue;
      }
      const lacking = ALL_ENTITY_IDS.filter(
        (e) =>
          !own.some((r) => r.entities?.includes(e) === true) ||
          !fx.rows[table].some((r) => r.ownedByActor !== true && r.entities?.includes(e) === true),
      );
      expect({ table, lacking }).toEqual({ table, lacking: [] });
    }
  });

  it('the fixture wrote every row it names', async () => {
    for (const table of TABLES) {
      const keys = fx.rows[table].map((r) => r.key);
      const found = await asMigrator((m) =>
        m.unsafe<{ n: number }[]>(
          `select count(*)::int as n from "${table}" x where ${MATRIX_ROW_KEY[table]} = any($1::text[])`,
          [keys],
        ),
      );
      expect({ table, found: found[0]?.n }).toEqual({ table, found: keys.length });
    }
  });

  describe.each(ROLES)('%s', (role) => {
    it.each(ALL_ENTITY_IDS)('acting in company %i', async (entityId) => {
      const acting = actingIn(role, entityId);
      const seen = await observe(acting, entityId, TABLES, (t) => fx.rows[t].map((r) => r.key));
      const problems: unknown[] = [];
      for (const table of TABLES) {
        const rule = RULES[table];
        const principal = readingAs(acting, table);
        // Whether any row of the table is the caller's to read in their own company.
        const readsOwn = fx.rows[table].some((r) =>
          allows(readingRowAs(acting, table, r), readRule(rule, r)),
        );
        const readsGroup = allows(principal, rule.group);
        const readsOwnRows = allows(principal, rule.ownRows);
        // People only: an agent reads customers by crm.account.read scope alone (0057).
        const readsThroughLead = principal.kind !== 'agent' && allows(principal, rule.throughLead);
        const readsLead = allows(principal, rule.lead);
        const expected = fx.rows[table]
          .filter((r) =>
            r.entities === null
              ? readsGroup
              : r.onLead === true
                ? readsLead && r.entities.includes(entityId)
                : (allows(readingRowAs(acting, table, r), readRule(rule, r)) &&
                    r.entities.includes(entityId)) ||
                  (readsOwnRows && r.ownedByActor === true) ||
                  (readsThroughLead && r.leadIn?.includes(entityId) === true),
          )
          .map((r) => r.key)
          .sort();
        const got = seen.get(table);
        if (!got) throw new Error(`no answer for ${table}`);
        if (JSON.stringify(got.seen) !== JSON.stringify(expected)) {
          problems.push({ table, expected, seen: got.seen });
        }
        if (got.leaked !== 0) problems.push({ table, rowsOfAnotherCompany: got.leaked });
        if (
          !readsOwn &&
          !readsGroup &&
          !readsOwnRows &&
          !readsThroughLead &&
          !readsLead &&
          got.total !== 0
        ) {
          problems.push({ table, withoutReadPermission: got.total });
        }
      }
      expect(problems).toEqual([]);
    });
  });
});

describe('the customer master is scoped through account_entities (ADR 0008)', () => {
  const CUSTOMER_TABLES: MatrixTable[] = [
    'accounts',
    'account_entities',
    'account_contacts',
    'contacts',
    'contact_phones',
    'customer_sites',
    'consents',
    'opportunities',
  ];
  const onlyInCompany2 = (table: MatrixTable): string[] =>
    fx.rows[table].filter((r) => r.entities?.length === 1 && r.entities[0] === 2).map((r) => r.key);

  it.each(ROLES)(
    '%s acting in company 1 never sees a customer related only to company 2',
    async (role) => {
      const seen = await observe(actingIn(role, 1), 1, CUSTOMER_TABLES, onlyInCompany2);
      for (const table of CUSTOMER_TABLES) {
        expect(onlyInCompany2(table).length).toBeGreaterThan(0);
        expect({ table, seen: seen.get(table)?.seen }).toEqual({ table, seen: [] });
      }
    },
  );
});
