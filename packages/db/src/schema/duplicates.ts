import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts } from './accounts';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { opportunities } from './opportunities';
import { principals } from './principals';

/**
 * Two customers, or two leads of one company, that may be one (PRD CRM-03, docs/design/phase1.md
 * §7.4). Found by lead creation and the nightly search through the definers of DATABASE §4.1, or
 * suggested by a person or an agent holding `crm.lead.merge`; a person merges the pair or says it
 * is not the same. `state` is written only by the duplicate commands through the
 * `duplicate_candidate` machine. A pair is stored in id order, so it is found once per company.
 */
export const duplicateCandidates = pgTable(
  'duplicate_candidates',
  {
    id: uuid('id').primaryKey(),
    /** The company the pair was found in, whose screens show it. */
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    kind: text('kind').notNull(),
    /** A customer pair: the two customers, the lower id first. */
    accountId: uuid('account_id').references(() => accounts.id),
    otherAccountId: uuid('other_account_id').references(() => accounts.id),
    /** A lead pair: the two leads of the company, the lower id first. */
    opportunityId: uuid('opportunity_id'),
    otherOpportunityId: uuid('other_opportunity_id'),
    reason: text('reason').notNull(),
    /** The facts behind the confidence (`DuplicateSignal`), strongest first. */
    signalsJson: jsonb('signals_json').notNull().default([]),
    confidence: smallint('confidence').notNull(),
    state: text('state').notNull().default('open'),
    decidedBy: uuid('decided_by').references(() => principals.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('duplicate_candidates_kind_check', sql`${t.kind} in ('customer', 'lead')`),
    check('duplicate_candidates_reason_check', sql`${t.reason} in ('phone', 'name_village')`),
    check('duplicate_candidates_state_check', sql`${t.state} in ('open', 'merged', 'dismissed')`),
    check('duplicate_candidates_confidence_check', sql`${t.confidence} between 1 and 100`),
    check(
      'duplicate_candidates_signals_check',
      sql`jsonb_typeof(${t.signalsJson}) = 'array' and jsonb_array_length(${t.signalsJson}) <= 4`,
    ),
    // Exactly the pair its kind names, in id order.
    check(
      'duplicate_candidates_pair_check',
      sql`(${t.kind} = 'customer' and ${t.accountId} < ${t.otherAccountId}
            and ${t.opportunityId} is null and ${t.otherOpportunityId} is null)
        or (${t.kind} = 'lead' and ${t.opportunityId} < ${t.otherOpportunityId}
            and ${t.accountId} is null and ${t.otherAccountId} is null)`,
    ),
    // A decided candidate names who decided and when; an open one names neither.
    check(
      'duplicate_candidates_decided_check',
      sql`(${t.state} = 'open') = (${t.decidedBy} is null) and (${t.decidedBy} is null) = (${t.decidedAt} is null)`,
    ),
    // Both leads of a lead pair belong to the candidate's company.
    foreignKey({
      name: 'duplicate_candidates_opportunity_fk',
      columns: [t.opportunityId, t.entityId],
      foreignColumns: [opportunities.id, opportunities.entityId],
    }),
    foreignKey({
      name: 'duplicate_candidates_other_opportunity_fk',
      columns: [t.otherOpportunityId, t.entityId],
      foreignColumns: [opportunities.id, opportunities.entityId],
    }),
    uniqueIndex('duplicate_candidates_customer_pair_unique')
      .on(t.entityId, t.accountId, t.otherAccountId)
      .where(sql`${t.kind} = 'customer'`),
    uniqueIndex('duplicate_candidates_lead_pair_unique')
      .on(t.opportunityId, t.otherOpportunityId)
      .where(sql`${t.kind} = 'lead'`),
    // The open cards of one customer (`listAccountDuplicates`) are one probe from either side.
    index('duplicate_candidates_account_idx').on(t.accountId, t.state),
    index('duplicate_candidates_other_account_idx').on(t.otherAccountId, t.state),
    index('duplicate_candidates_other_opportunity_idx').on(t.otherOpportunityId),
    // `/duplicates` pages the open candidates surest first (`listDuplicates`).
    index('duplicate_candidates_open_idx')
      .on(t.confidence.desc(), t.createdAt.desc(), t.id.desc())
      .where(sql`${t.state} = 'open'`),
    index('duplicate_candidates_decided_by_idx').on(t.decidedBy),
  ],
);

/**
 * A customer merge (`crm.customer.merge`), keeping the ids of everything it moved from the merged
 * customer to the kept one (`moved_json`: contacts with the role each had, sites, relationships
 * with the companies, leads, tasks, tags, consents and timeline rows), so `crm.customer.unmerge`
 * can move them back. Written only by the definers `app.merge_customers()` and
 * `app.unmerge_customers()`; read with the kept customer.
 */
export const customerMerges = pgTable(
  'customer_merges',
  {
    id: uuid('id').primaryKey(),
    /** The company whose screen the merge was made from. */
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    keptAccountId: uuid('kept_account_id')
      .notNull()
      .references(() => accounts.id),
    mergedAccountId: uuid('merged_account_id')
      .notNull()
      .references(() => accounts.id),
    candidateId: uuid('candidate_id').references(() => duplicateCandidates.id),
    movedJson: jsonb('moved_json').notNull(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneBy: uuid('undone_by').references(() => principals.id),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('customer_merges_pair_check', sql`${t.keptAccountId} <> ${t.mergedAccountId}`),
    check('customer_merges_undone_check', sql`(${t.undoneAt} is null) = (${t.undoneBy} is null)`),
    check('customer_merges_moved_check', sql`jsonb_typeof(${t.movedJson}) = 'object'`),
    // A customer is merged away once at a time: undo the merge before merging it again.
    uniqueIndex('customer_merges_live_unique')
      .on(t.mergedAccountId)
      .where(sql`${t.undoneAt} is null`),
    // The merges into a customer, newest first, for its Account 360 card.
    index('customer_merges_kept_idx').on(t.keptAccountId, t.createdAt.desc()),
    index('customer_merges_candidate_idx').on(t.candidateId),
    index('customer_merges_undone_by_idx').on(t.undoneBy),
  ],
);
