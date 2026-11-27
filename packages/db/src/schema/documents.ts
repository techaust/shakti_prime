import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { actors, actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { files } from './files';
import { principals } from './principals';

/*
 * J3 Customer documents and requirements (docs/03-roadmap-appendix/phase4.md §6.3, SECURITY §5).
 * The lists of kinds and keys are the contracts' (`packages/contracts/src/documents`), paired in
 * `enum-sync.test.ts`.
 */

const KINDS = sql.raw(
  "'electricity_bill', 'identity_proof', 'property_papers', 'site_photo', 'sanctioned_load_letter', 'agreement', 'commissioning_report', 'net_meter_certificate', 'bank_proof'",
);
const REQUIREMENT_KEYS = sql.raw(
  "'electricity_bill', 'identity_proof', 'property_papers', 'site_photos', 'sanctioned_load_letter', 'agreement', 'commissioning_report', 'net_meter_certificate', 'bank_proof'",
);

/**
 * The documents a step of a flow asks for, per company: seeded from the workshop's defaults
 * (PROJ-1) by `pnpm db:seed`, which writes only the keys, and changed by an Executive in Settings ›
 * Document requirements (`documents.requirement.set`). A requirement is turned off, never removed,
 * so the seed never brings back one an Executive took away.
 */
export const documentRequirements = pgTable(
  'document_requirements',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    flow: text('flow').notNull(),
    stepKey: text('step_key').notNull(),
    requirementKey: text('requirement_key').notNull(),
    mandatory: boolean('mandatory').notNull(),
    acceptedKinds: text('accepted_kinds').array().notNull(),
    position: smallint('position').notNull(),
    active: boolean('active').notNull().default(true),
    ...timestamps,
    ...actors,
  },
  (t) => [
    check('document_requirements_flow_check', sql`${t.flow} in ('standard', 'surya_ghar')`),
    check('document_requirements_step_key_check', sql`${t.stepKey} ~ '^[a-z][a-z0-9_]{1,39}$'`),
    check(
      'document_requirements_requirement_key_check',
      sql`${t.requirementKey} in (${REQUIREMENT_KEYS})`,
    ),
    check(
      'document_requirements_accepted_kinds_check',
      sql`cardinality(${t.acceptedKinds}) between 1 and 9
          and ${t.acceptedKinds} <@ array[${KINDS}]::text[]`,
    ),
    check('document_requirements_position_check', sql`${t.position} between 1 and 99`),
    unique('document_requirements_step_key_unique').on(
      t.entityId,
      t.flow,
      t.stepKey,
      t.requirementKey,
    ),
  ],
);

/**
 * A customer's filed document (phase4 §5): a masked, clean `customer_document` file of the
 * company, filed against the customer it was uploaded for, and against a requirement or as a loose
 * document of its kind. `sensitive` (identity and bank papers) is read only with
 * `documents.sensitive.read`. Unfiling keeps the row with its reason; nothing is deleted.
 * `project_id` waits for J1's `projects`, whose foreign key is added when J1 merges.
 */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    projectId: uuid('project_id'),
    requirementKey: text('requirement_key'),
    kind: text('kind').notNull(),
    fileId: uuid('file_id').notNull(),
    sensitive: boolean('sensitive').notNull(),
    filedByKind: text('filed_by_kind').notNull(),
    filedBy: uuid('filed_by')
      .notNull()
      .references(() => principals.id),
    /** The classifier's confidence (J7); null when a person filed it. */
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    filedAt: timestamp('filed_at', { withTimezone: true }).notNull().defaultNow(),
    unfiledAt: timestamp('unfiled_at', { withTimezone: true }),
    unfiledBy: uuid('unfiled_by').references(() => principals.id),
    unfiledReason: text('unfiled_reason'),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    foreignKey({
      name: 'documents_file_entity_fk',
      columns: [t.fileId, t.entityId],
      foreignColumns: [files.id, files.entityId],
    }),
    check(
      'documents_requirement_key_check',
      sql`${t.requirementKey} is null or ${t.requirementKey} in (${REQUIREMENT_KEYS})`,
    ),
    check('documents_kind_check', sql`${t.kind} in (${KINDS})`),
    // Identity and bank papers are always sensitive, whoever files them.
    check(
      'documents_sensitive_check',
      sql`${t.sensitive} or ${t.kind} not in ('identity_proof', 'bank_proof')`,
    ),
    check('documents_filed_by_kind_check', sql`${t.filedByKind} in ('person', 'classifier')`),
    check(
      'documents_confidence_check',
      sql`(${t.filedByKind} = 'person' and ${t.confidence} is null)
          or (${t.filedByKind} = 'classifier' and ${t.confidence} between 0 and 1)`,
    ),
    check(
      'documents_unfiled_check',
      sql`(${t.unfiledAt} is null and ${t.unfiledBy} is null and ${t.unfiledReason} is null)
          or (${t.unfiledAt} is not null and ${t.unfiledBy} is not null
              and length(btrim(${t.unfiledReason})) between 3 and 300)`,
    ),
    // The target of the identity documents' composite key.
    unique('documents_id_entity_unique').on(t.id, t.entityId),
    // A file is filed once at a time.
    uniqueIndex('documents_file_filed_unique')
      .on(t.fileId)
      .where(sql`${t.unfiledAt} is null`),
    // A customer's documents in the company, newest first (Account 360 and the Documents tab).
    index('documents_account_filed_idx').on(t.entityId, t.accountId, t.filedAt.desc(), t.id),
    // A project's documents, for the completeness check (J1).
    index('documents_project_idx')
      .on(t.projectId, t.requirementKey)
      .where(sql`${t.projectId} is not null and ${t.unfiledAt} is null`),
    index('documents_account_idx').on(t.accountId),
  ],
);

/**
 * What is kept of an identity document's number (SECURITY §5): its kind and last four digits, and
 * the masked file. No column can hold more of the number. Read only with
 * `documents.sensitive.read`, with its document, while the document stays filed.
 */
export const identityDocuments = pgTable(
  'identity_documents',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    documentId: uuid('document_id').notNull(),
    kind: text('kind').notNull(),
    last4: text('last4').notNull(),
    maskedFileId: uuid('masked_file_id').notNull(),
    createdAt: timestamps.createdAt,
    createdBy: actorsRequired.createdBy,
  },
  (t) => [
    foreignKey({
      name: 'identity_documents_document_entity_fk',
      columns: [t.documentId, t.entityId],
      foreignColumns: [documents.id, documents.entityId],
    }),
    foreignKey({
      name: 'identity_documents_file_entity_fk',
      columns: [t.maskedFileId, t.entityId],
      foreignColumns: [files.id, files.entityId],
    }),
    check('identity_documents_kind_check', sql`${t.kind} in ('aadhaar', 'pan', 'bank_proof')`),
    check('identity_documents_last4_check', sql`${t.last4} ~ '^[0-9]{4}$'`),
    unique('identity_documents_document_number_unique').on(t.documentId, t.kind, t.last4),
    index('identity_documents_account_idx').on(t.accountId),
    index('identity_documents_file_idx').on(t.maskedFileId),
  ],
);
