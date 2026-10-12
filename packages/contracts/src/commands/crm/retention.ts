import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';

// The anonymisation of unqualified leads idle for the retention period (BLUEPRINT §7.9,
// docs/03-roadmap-appendix/phase1.md §10): the nightly job looks at one company's leads a batch
// at a time, oldest last change first, and removes the personal details of those that never went
// ahead. A dry run counts them and changes nothing.

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
 * What one batch of `crm.lead.anonymise` did: the leads it looked at, those it anonymised, where
 * the next batch starts (null when the company is done), and whether the batch failed, in which
 * case nothing in it changed and the failure is recorded in `retention_runs`.
 */
export const LeadAnonymiseBatchDto = z
  .object({
    entityId: EntityIdSchema,
    examined: Count,
    anonymised: Count,
    next: LeadRetentionCursorSchema.nullable(),
    failed: z.boolean(),
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
