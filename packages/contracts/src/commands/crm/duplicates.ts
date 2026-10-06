import { z } from 'zod';
import {
  DuplicateKindSchema,
  DuplicateReasonSchema,
  DuplicateSignalSchema,
  DuplicateStateSchema,
} from '../../crm/duplicates';
import { AccountTypeSchema, OpportunityStateSchema } from '../../crm/enums';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * The duplicate commands and reads (PRD CRM-03, docs/03-roadmap-appendix/phase1.md §7.4). Each names the
 * company the request is narrowed to: the one whose screen the person acts from.
 */

const Count = z.number().int().min(0);

/**
 * `crm.customer.merge`: the customer `mergedAccountId` is folded into `keptAccountId`. Its
 * contacts, sites, relationships with the companies, leads (with their tasks and tags) and
 * timeline move to the kept customer, its consents with its contacts, and it is archived; the
 * merge is recorded so it can be undone. `candidateId` is the duplicate card it was made from.
 */
export const MergeCustomersInput = z
  .object({
    entityId: EntityIdSchema,
    keptAccountId: IdSchema,
    mergedAccountId: IdSchema,
    candidateId: IdSchema.optional(),
  })
  .strict()
  .refine((v) => v.keptAccountId !== v.mergedAccountId, {
    message: 'a customer is not merged into itself',
    path: ['mergedAccountId'],
  });
export type MergeCustomersInput = z.infer<typeof MergeCustomersInput>;

/** `crm.customer.unmerge`: everything a merge moved goes back, and the customer returns. */
export const UnmergeCustomersInput = z
  .object({ entityId: EntityIdSchema, mergeId: IdSchema })
  .strict();
export type UnmergeCustomersInput = z.infer<typeof UnmergeCustomersInput>;

/** How many of each kind of row a customer merge moved. */
export const CustomerMergeMovedDto = z
  .object({
    contacts: Count,
    sites: Count,
    relationships: Count,
    leads: Count,
    tasks: Count,
    tags: Count,
    consents: Count,
    activities: Count,
  })
  .strict();
export type CustomerMergeMovedDto = z.infer<typeof CustomerMergeMovedDto>;

export const CustomerMergeDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    keptAccountId: IdSchema,
    mergedAccountId: IdSchema,
    moved: CustomerMergeMovedDto,
    undoneAt: z.iso.datetime().nullable(),
  })
  .strict();
export type CustomerMergeDto = z.infer<typeof CustomerMergeDto>;

/**
 * `crm.lead.merge`: two leads of one customer and one segment in one company become one. The merged
 * lead's open tasks and its tags move to the kept lead, and the merged lead is closed (archived);
 * its timeline stays on the customer. A referral partner of the merged lead goes to a kept lead
 * with none (CRM-09); two leads of two partners are not merged.
 */
export const MergeLeadsInput = z
  .object({
    entityId: EntityIdSchema,
    keptOpportunityId: IdSchema,
    mergedOpportunityId: IdSchema,
    candidateId: IdSchema.optional(),
  })
  .strict()
  .refine((v) => v.keptOpportunityId !== v.mergedOpportunityId, {
    message: 'a lead is not merged into itself',
    path: ['mergedOpportunityId'],
  });
export type MergeLeadsInput = z.infer<typeof MergeLeadsInput>;

export const LeadMergeDto = z
  .object({
    entityId: EntityIdSchema,
    keptOpportunityId: IdSchema,
    mergedOpportunityId: IdSchema,
    moved: z.object({ tasks: Count, tags: Count }).strict(),
    /** The merged lead's referral partner, now the kept lead's; null when none moved. */
    referralPartnerId: IdSchema.nullable(),
  })
  .strict();
export type LeadMergeDto = z.infer<typeof LeadMergeDto>;

/** `crm.duplicate.dismiss`: a person says the pair is not the same. */
export const DismissDuplicateInput = z
  .object({ entityId: EntityIdSchema, candidateId: IdSchema })
  .strict();
export type DismissDuplicateInput = z.infer<typeof DismissDuplicateInput>;

/**
 * `crm.duplicate.suggest`: two open leads of one customer and segment in one company put forward
 * as one. The one duplicate step an agent may take (docs/07-security.md §3.3): it suggests, a person
 * decides.
 */
export const SuggestDuplicateInput = z
  .object({ entityId: EntityIdSchema, opportunityId: IdSchema, otherOpportunityId: IdSchema })
  .strict()
  .refine((v) => v.opportunityId !== v.otherOpportunityId, {
    message: 'a lead is not a duplicate of itself',
    path: ['otherOpportunityId'],
  });
export type SuggestDuplicateInput = z.infer<typeof SuggestDuplicateInput>;

export const DuplicateCandidateDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    kind: DuplicateKindSchema,
    state: DuplicateStateSchema,
    reason: DuplicateReasonSchema,
    confidence: z.number().int().min(1).max(100),
  })
  .strict();
export type DuplicateCandidateDto = z.infer<typeof DuplicateCandidateDto>;

/**
 * `crm.duplicate.scan`: the nightly search of one company's customers, in id order after
 * `afterId`, a batch at a time.
 */
export const ScanDuplicatesInput = z
  .object({ entityId: EntityIdSchema, afterId: IdSchema.nullable() })
  .strict();
export type ScanDuplicatesInput = z.infer<typeof ScanDuplicatesInput>;

/** How many candidates a batch found, and where the next batch starts (null when done). */
export const DuplicateScanDto = z
  .object({ entityId: EntityIdSchema, found: Count, nextAfterId: IdSchema.nullable() })
  .strict();
export type DuplicateScanDto = z.infer<typeof DuplicateScanDto>;

// --- Reads ------------------------------------------------------------------------------------

/** One side of a candidate as its card shows it: a customer, and for a lead pair its lead. */
export const DuplicateSideDto = z
  .object({
    accountId: IdSchema,
    accountName: z.string(),
    accountType: AccountTypeSchema,
    /** The last four digits of the main number; never the whole number on a card. */
    phoneLast4: z
      .string()
      .regex(/^[0-9]{4}$/)
      .nullable(),
    village: z.string().nullable(),
    entityIds: z.array(EntityIdSchema),
    opportunityId: IdSchema.nullable(),
    pipelineName: z.string().nullable(),
    stageName: z.string().nullable(),
    opportunityState: OpportunityStateSchema.nullable(),
    ownerName: z.string().nullable(),
  })
  .strict();
export type DuplicateSideDto = z.infer<typeof DuplicateSideDto>;

export const DuplicateRowDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    kind: DuplicateKindSchema,
    reason: DuplicateReasonSchema,
    signals: z.array(DuplicateSignalSchema),
    confidence: z.number().int().min(1).max(100),
    state: DuplicateStateSchema,
    createdAt: z.iso.datetime(),
    first: DuplicateSideDto,
    second: DuplicateSideDto,
  })
  .strict();
export type DuplicateRowDto = z.infer<typeof DuplicateRowDto>;

/** `/duplicates`: open candidates the caller sees in the request's companies, surest first. */
export const ListDuplicatesInput = z
  .object({
    kind: DuplicateKindSchema.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListDuplicatesInput = z.input<typeof ListDuplicatesInput>;

export const DuplicatePageDto = z
  .object({ items: z.array(DuplicateRowDto), nextCursor: z.string().nullable() })
  .strict();
export type DuplicatePageDto = z.infer<typeof DuplicatePageDto>;

/** A merge into a customer that can still be undone, for the card on Account 360. */
export const CustomerMergeSummaryDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    mergedAccountId: IdSchema,
    // The merged customer's name while the caller still sees it (it keeps a relationship).
    mergedAccountName: z.string().nullable(),
    moved: CustomerMergeMovedDto,
    mergedAt: z.iso.datetime(),
  })
  .strict();
export type CustomerMergeSummaryDto = z.infer<typeof CustomerMergeSummaryDto>;

/** The duplicate cards of one customer in one company: open candidates and merges into it. */
export const ListAccountDuplicatesInput = z
  .object({ entityId: EntityIdSchema, accountId: IdSchema })
  .strict();
export type ListAccountDuplicatesInput = z.input<typeof ListAccountDuplicatesInput>;

export const AccountDuplicatesDto = z
  .object({
    candidates: z.array(DuplicateRowDto),
    merges: z.array(CustomerMergeSummaryDto),
    /** Whether the caller may merge, undo and dismiss (`crm.lead.merge`). */
    canMerge: z.boolean(),
  })
  .strict();
export type AccountDuplicatesDto = z.infer<typeof AccountDuplicatesDto>;

/** What a customer merge would move, for the merge dialog to show before anyone confirms. */
export const PreviewCustomerMergeInput = z
  .object({ entityId: EntityIdSchema, keptAccountId: IdSchema, mergedAccountId: IdSchema })
  .strict();
export type PreviewCustomerMergeInput = z.input<typeof PreviewCustomerMergeInput>;
