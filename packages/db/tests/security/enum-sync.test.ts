import {
  AccountTypeSchema,
  AUDIT_OUTCOMES,
  ConsentChannelSchema,
  ConsentPurposeSchema,
  ConsentSourceSchema,
  ContactRoleSchema,
  CustomerLanguageSchema,
  DocTypeSchema,
  FilePurposeSchema,
  FileStatusSchema,
  ImportCreatedTypeSchema,
  ImportFormatSchema,
  ImportJobStateSchema,
  ImportKindSchema,
  ImportRowStateSchema,
  ItemUnitSchema,
  LeadChannelSchema,
  OpportunityStateSchema,
  PrincipalKindSchema,
  ROLE_KEYS,
  SavedViewScreenSchema,
  SCOPES,
  SegmentSchema,
  SESSION_REVOKE_REASONS,
  SiteTypeSchema,
  StageKindSchema,
  ThemeSchema,
  ContrastSchema,
  USER_STATUSES,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { asMigrator, closeDb, withoutContext } from '../../src/testing/index';

afterAll(closeDb);

/**
 * Every list-valued check constraint and the contract enum it must equal (AUDIT M43). A value
 * added on one side only would pass validation and then fail in the database, or the reverse.
 */
const PAIRS: Record<string, readonly string[]> = {
  account_contacts_role_check: ContactRoleSchema.options,
  accounts_type_check: AccountTypeSchema.options,
  audit_logs_actor_kind_check: PrincipalKindSchema.options,
  audit_logs_outcome_check: AUDIT_OUTCOMES,
  composite_supply_rules_segment_check: SegmentSchema.options,
  consents_channel_check: ConsentChannelSchema.options,
  consents_purpose_check: ConsentPurposeSchema.options,
  consents_source_check: ConsentSourceSchema.options,
  contacts_preferred_language_check: CustomerLanguageSchema.options,
  customer_sites_type_check: SiteTypeSchema.options,
  document_sequences_doc_type_check: DocTypeSchema.options,
  files_purpose_check: FilePurposeSchema.options,
  files_status_check: FileStatusSchema.options,
  import_jobs_format_check: ImportFormatSchema.options,
  import_jobs_kind_check: ImportKindSchema.options,
  import_jobs_state_check: ImportJobStateSchema.options,
  import_mapping_templates_kind_check: ImportKindSchema.options,
  import_rows_created_type_check: ImportCreatedTypeSchema.options,
  import_rows_state_check: ImportRowStateSchema.options,
  items_unit_check: ItemUnitSchema.options,
  lead_sources_channel_check: LeadChannelSchema.options,
  opportunities_state_check: OpportunityStateSchema.options,
  pipeline_stages_kind_check: StageKindSchema.options,
  pipelines_segment_check: SegmentSchema.options,
  principals_kind_check: PrincipalKindSchema.options,
  roles_key_check: ROLE_KEYS,
  role_permissions_scope_check: SCOPES,
  saved_views_screen_check: SavedViewScreenSchema.options,
  sessions_revoked_reason_check: SESSION_REVOKE_REASONS,
  users_status_check: USER_STATUSES,
  users_theme_check: ThemeSchema.options,
  users_contrast_check: ContrastSchema.options,
};

describe('database value lists and contract enums agree (AUDIT M43)', () => {
  it('every list-valued check is paired, and each pair holds the same values', async () => {
    // Postgres renders `in ('a', 'b')` as `= ANY (ARRAY[...])`, but a one-value `in ('a')` as a
    // plain `col = 'a'::text`, so both forms count as a value list.
    const rows = await withoutContext<{ name: string; def: string }>(sql`
      select c.conname as name, pg_get_constraintdef(c.oid) as def
        from pg_constraint c join pg_namespace n on n.oid = c.connamespace
       where n.nspname = 'public' and c.contype = 'c'
         and (pg_get_constraintdef(c.oid) like '%ARRAY[%'
              or pg_get_constraintdef(c.oid) ~ '[a-z_]+ = ''[^'']*''::text')
       order by 1
    `);
    expect(rows.map((r) => r.name)).toEqual(Object.keys(PAIRS).sort());
    for (const { name, def } of rows) {
      const inDatabase = [...def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]).sort();
      expect({ name, values: inDatabase }).toEqual({
        name,
        values: [...(PAIRS[name] ?? [])].sort(),
      });
    }
  });
});

describe('the set of roles is fixed (AUDIT L17)', () => {
  it('refuses a role key outside the catalogue, even for the table owner', async () => {
    await expect(
      asMigrator(
        (m) => m`insert into roles (id, key, name, is_system)
          values ('01990000-0000-7000-8000-0000000e1701', 'regional_head', 'Regional head', false)`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'roles_key_check' });
  });
});

describe('value ranges the database holds (AUDIT L3)', () => {
  it('a composite-supply split stays within 0 to 100 on every share and rate', async () => {
    await expect(
      asMigrator(
        (m) => m`insert into composite_supply_rules
          (id, segment, goods_share_pct, services_share_pct, goods_rate_pct, services_rate_pct, effective_from)
          values ('01990000-0000-7000-8000-0000000e1702', 'commercial_epc', 150.00, -50.00, 5.00, 18.00, '2031-04-01')`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'composite_supply_rules_range_check' });
  });

  it('a site point is on the globe', async () => {
    await expect(
      asMigrator(
        (m) => m`insert into customer_sites (id, account_id, type, lat, lng, created_by)
          select '01990000-0000-7000-8000-0000000e1703', a.id, 'borewell', 95.0, 75.0, a.created_by
            from accounts a limit 1`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'customer_sites_point_check' });
  });
});
