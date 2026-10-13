import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';

// The anonymisation of unqualified leads idle for the retention period (BLUEPRINT §7.9,
// docs/03-roadmap-appendix/phase1.md §10): the nightly job looks at one company's leads a batch
// at a time, oldest last change first, and removes the personal details of those that never went
// ahead. A dry run counts them and changes nothing.

/**
 * Why the retention job keeps a lead (`opportunities.retention_kept_reason`), so its window passes
 * the lead by. Most reasons never come undone: the lead won or reached Qualified, a quote, an order
 * or a commission of it or its customer, the customer's dealer credit or referral partner record,
 * another lead of the customer that went ahead (`other_lead`), or a company that knows the customer
 * with no lead of it there (`customer`). Two can lapse, and the change that ends them clears the
 * mark: the customer's type as a dealer or referral partner (`dealer`, cleared when the type
 * changes back) and a merge that stands (`merge`, cleared when it is undone).
 */
export const LEAD_RETENTION_KEPT_REASONS = [
  'won',
  'qualified',
  'quote',
  'order',
  'commission',
  'dealer_credit',
  'referral_partner',
  'other_lead',
  'customer',
  'dealer',
  'merge',
] as const;
export type LeadRetentionKeptReason = (typeof LEAD_RETENTION_KEPT_REASONS)[number];

/**
 * Where the next batch starts: after the last lead the previous batch looked at, by the time of
 * its last change (exact to the microsecond, as the database writes it) and its id.
 */
export const LeadRetentionCursorSchema = z
  .object({
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/),
    id: IdSchema,
  })
  .strict();
export type LeadRetentionCursor = z.infer<typeof LeadRetentionCursorSchema>;

/**
 * `crm.lead.anonymise`, and its dry run `countStaleLeads`: one batch of one company's leads, from
 * the start (`after` null) or after the cursor the previous batch answered.
 */
export const AnonymiseStaleLeadsInput = z
  .object({
    entityId: EntityIdSchema,
    after: LeadRetentionCursorSchema.nullable().default(null),
  })
  .strict();
export type AnonymiseStaleLeadsInput = z.input<typeof AnonymiseStaleLeadsInput>;

const Count = z.number().int().min(0);

/**
 * What one batch of `crm.lead.anonymise` did: the leads it looked at, those it anonymised (each
 * customer with all its leads), the leads it found kept for good (which the window passes by
 * from then on), the customers whose anonymisation failed (each changed nothing and is recorded
 * in `retention_runs`; the others went on), and where the next batch starts (null when the
 * company is done).
 */
export const LeadAnonymiseBatchDto = z
  .object({
    entityId: EntityIdSchema,
    examined: Count,
    anonymised: Count,
    kept: Count,
    failedCustomers: Count,
    next: LeadRetentionCursorSchema.nullable(),
  })
  .strict();
export type LeadAnonymiseBatchDto = z.infer<typeof LeadAnonymiseBatchDto>;

/** What one batch of the dry run found: the leads it looked at and those the job would anonymise. */
export const StaleLeadCountDto = z
  .object({
    entityId: EntityIdSchema,
    examined: Count,
    stale: Count,
    next: LeadRetentionCursorSchema.nullable(),
  })
  .strict();
export type StaleLeadCountDto = z.infer<typeof StaleLeadCountDto>;
