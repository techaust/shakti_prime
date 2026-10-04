// Synthetic rows for the role × company visibility matrix (docs/SECURITY.md §11 item 1), written
// with the migrator connection: for every company one row in each table of ENTITY_TABLES, one
// customer shared by companies 1 and 2 (ADR 0008), and the group-wide rows (`entity_id null`) of
// the tables that allow them. Fixed ids so the fixture is re-creatable, except the audit rows,
// and the timeline rows, which are append-only and get new ids each run. Values are test data,
// never copy.
// `user_entity_roles` is the one table whose policy also shows the caller's own rows in any
// company (0049), so the owner holds a role in every company, as does a second person.
import { newId } from '@shakti/contracts';
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
 * Shared reference tables that allow `entity_id null` for the whole group (docs/DATABASE.md §1)
 * beside rows of one company. `teams` is the fourth, and sits in ENTITY_TABLES.
 */
export const GROUP_WIDE_SHARED_TABLES = ['pipelines', 'pipeline_stages', 'price_lists'] as const;
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
  pipelines: 'x.id::text',
  pipeline_stages: 'x.id::text',
  price_lists: 'x.id::text',
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
      await tx`delete from user_entity_roles where id::text like ${like}`;
      await tx`delete from users where id::text like ${like}`;
      await tx`delete from import_rows where job_id::text like ${like}`;
      await tx`delete from import_jobs where id::text like ${like}`;
      await tx`delete from import_mapping_templates where id::text like ${like}`;
      await tx`delete from files where id::text like ${like}`;
      await tx`delete from item_costs where id::text like ${like}`;
      await tx`delete from items where id::text like ${like}`;
      await tx`delete from document_sequences where id::text like ${like}`;
      await tx`delete from tasks where id::text like ${like}`;
      await tx`delete from opportunity_tags where opportunity_id::text like ${like}`;
      await tx`delete from tags where id::text like ${like}`;
      await tx`delete from consents where id::text like ${like}`;
      await tx`delete from opportunities where id::text like ${like}`;
      await tx`delete from customer_sites where id::text like ${like}`;
      await tx`delete from account_contacts where account_id::text like ${like}`;
      await tx`delete from contact_phones where id::text like ${like}`;
      await tx`delete from account_entities where account_id::text like ${like}`;
      await tx`delete from accounts where id::text like ${like}`;
      await tx`delete from contacts where id::text like ${like}`;
      await tx`delete from price_lists where id::text like ${like}`;
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
    pipelines: [{ key: groupPipeline, entities: null }],
    pipeline_stages: [{ key: groupStage, entities: null }],
    price_lists: [{ key: groupPriceList, entities: null }],
  };
  const groupAudit = newId();
  rows.audit_logs.push({ key: groupAudit, entities: null });
  rows.tags.push({ key: groupTag, entities: null });

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
      await tx`insert into items (id, sku, name, category, hsn, unit)
        values (${item}, 'FX-MATRIX', 'matrix item', 'pump', '8413', 'nos')`;
      await tx`insert into pipelines (id, entity_id, key, name, segment)
        values (${groupPipeline}, null, 'matrix-group', 'matrix group pipeline', 'farmer_pumps')`;
      await tx`insert into pipeline_stages (id, pipeline_id, entity_id, key, name, position)
        values (${groupStage}, ${groupPipeline}, null, 'matrix-group', 'matrix group stage', 1)`;
      // Archived lists stay readable and sit outside the one-live-list-per-tier rule.
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
        values (${groupPriceList}, ${tierId('retail')}, null, 9000, '2090-01-01', now())`;
      await tx`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command, outcome)
        values (${groupAudit}, null, ${ownerId}, 'user', ${ENTITY_MATRIX_AUDIT_COMMAND}, 'ok')`;

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
        await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, created_by)
          values (${file}, ${e}, 'import', 'matrix', ${`matrix/${file}`}, 'matrix.csv', 'text/csv', 1, ${sha}, ${ownerId})`;
        for (const [purpose, fileId, type] of purposeFiles) {
          await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
            values (${fileId}, ${e}, ${purpose}, 'matrix', ${`matrix/${fileId}`}, 'matrix file', ${type}, 1, ${sha}, 'ready', ${ownerId})`;
        }
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
        await tx`insert into user_entity_roles (id, user_id, entity_id, role_id, team_id, created_by) values
          (${ownerRole}, ${ownerId}, ${e}, ${MATRIX_ROLE}, ${team}, ${ownerId}),
          (${otherRole}, ${otherUserId}, ${e}, ${MATRIX_ROLE}, null, ${ownerId})`;

        rows.entities.push({ key: e.toString(), entities: only });
        rows.teams.push({ key: team, entities: only });
        rows.contacts.push({ key: contact, entities: only, leadIn: only });
        rows.contact_phones.push({ key: phone, entities: only, leadIn: only });
        rows.accounts.push({ key: account, entities: only, leadIn: only });
        rows.account_entities.push({ key: link, entities: only, leadIn: only });
        rows.account_contacts.push({ key: `${account}/${contact}`, entities: only, leadIn: only });
        rows.customer_sites.push({ key: site, entities: only, leadIn: only });
        rows.opportunities.push({ key: opportunity, entities: only });
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
        rows.tasks.push({ key: task, entities: only });
        rows.tags.push({ key: tag, entities: only });
        rows.opportunity_tags.push({ key: `${opportunity}/${tag}`, entities: only });
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
