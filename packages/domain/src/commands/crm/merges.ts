import {
  CustomerMergeDto,
  CustomerMergeMovedDto,
  DomainError,
  LeadMergeDto,
  MergeCustomersInput,
  MergeLeadsInput,
  newId,
  UnmergeCustomersInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { cancelCallTasks } from './call-tasks';
import { heldByColleague } from './create-lead';
import { decideCandidate, lockCandidate } from './duplicates';
import { requireEntity } from './opportunity-shared';

/**
 * Customer and lead merges (PRD CRM-03, docs/03-roadmap-appendix/phase1.md §7.4). Every merge is for people:
 * an agent only suggests a candidate (SECURITY §3.3). A merge runs in a definer that checks the
 * caller may change both customers in every company each is related to, and every lead it moves,
 * before it moves anything (`app.merge_customers()`, `app.unmerge_customers()`,
 * `app.merge_leads()`; DATABASE §4.1), because it reaches rows no request may change directly: the
 * append-only timeline, a lead's customer and a task's lead.
 */

/** What `app.merge_customers()` recorded it moved: the ids of each kind. */
const Moved = z
  .object({
    contacts: z.array(z.object({ id: z.string(), role: z.string() })),
    sites: z.array(z.string()),
    relationships: z.array(z.string()),
    leads: z.array(z.string()),
    tasks: z.array(z.string()),
    tags: z.array(z.unknown()),
    consents: z.array(z.string()),
    activities: z.array(z.string()),
  })
  .loose();

/** How many of each kind a merge moved, from what it recorded. */
export function movedCounts(value: unknown): CustomerMergeMovedDto {
  const moved = Moved.parse(value);
  return CustomerMergeMovedDto.parse({
    contacts: moved.contacts.length,
    sites: moved.sites.length,
    relationships: moved.relationships.length,
    leads: moved.leads.length,
    tasks: moved.tasks.length,
    tags: moved.tags.length,
    consents: moved.consents.length,
    activities: moved.activities.length,
  });
}

/** The counts a merge moved as the audit row names them (`movedLeads`, …). */
function movedFields(moved: CustomerMergeMovedDto): Record<string, number> {
  return {
    movedContacts: moved.contacts,
    movedSites: moved.sites,
    movedRelationships: moved.relationships,
    movedLeads: moved.leads,
    movedTasks: moved.tasks,
    movedTags: moved.tags,
    movedConsents: moved.consents,
    movedActivities: moved.activities,
  };
}

/** A refusal of a definer's answer that is not `merged` or `undone`. */
function refusal(status: string): DomainError {
  switch (status) {
    case 'missing':
      return new DomainError('not_found', 'a customer of the merge is not available', {
        reason: 'account_missing',
      });
    case 'held_by_other':
      return heldByColleague();
    case 'other_company':
      return new DomainError(
        'conflict',
        'a customer of the merge is in a company of the group the caller does not work for',
        {
          reason: 'merge_other_company',
        },
      );
    case 'kept_merged':
      return new DomainError('conflict', 'the kept customer was merged into another since', {
        reason: 'merge_undo_later_first',
      });
    case 'partner':
      return new DomainError('validation_failed', 'a referral partner is never merged away', {
        reason: 'merge_partner_account',
      });
    case 'undone_already':
      return new DomainError('conflict', 'the merge was already undone', {
        reason: 'merge_undone_already',
      });
    case 'not_open':
      return new DomainError('conflict', 'a lead of the pair is closed', {
        reason: 'merge_lead_closed',
      });
    case 'different_customers':
      return new DomainError('validation_failed', 'the leads belong to two customers', {
        reason: 'merge_customers_first',
      });
    case 'other_segment':
      return new DomainError('validation_failed', 'the leads are for two kinds of work', {
        reason: 'merge_leads_other_segment',
      });
    case 'two_partners':
      return new DomainError('conflict', 'each lead came through its own referral partner', {
        reason: 'merge_leads_two_partners',
      });
    case 'keep_open':
      return new DomainError('validation_failed', 'the open lead is kept over one in nurture', {
        reason: 'merge_leads_keep_open',
      });
    default:
      return new DomainError('internal', `the merge answered ${status}`);
  }
}

/** The candidate a merge was made from, which must name exactly this pair. */
async function candidateOfPair(
  ctx: CommandContext,
  entityId: number,
  candidateId: string | undefined,
  kind: 'customer' | 'lead',
  pair: readonly [string, string],
) {
  if (candidateId === undefined) return undefined;
  const row = await lockCandidate(ctx, entityId, candidateId);
  const [low, high] = pair[0] < pair[1] ? pair : [pair[1], pair[0]];
  const names =
    kind === 'customer'
      ? row.kind === 'customer' && row.accountId === low && row.otherAccountId === high
      : row.kind === 'lead' && row.opportunityId === low && row.otherOpportunityId === high;
  if (!names) {
    throw new DomainError('validation_failed', 'the duplicate names another pair', {
      reason: 'duplicate_missing',
    });
  }
  return row;
}

/** Whether the customer is related to the company, so a timeline row about it can be written there. */
async function relatedHere(
  ctx: CommandContext,
  accountId: string,
  entityId: number,
): Promise<boolean> {
  const ae = schema.accountEntities;
  const [row] = await ctx.tx
    .select({ id: ae.id })
    .from(ae)
    .where(and(eq(ae.accountId, accountId), eq(ae.entityId, entityId)))
    .limit(1);
  return row !== undefined;
}

/**
 * `crm.customer.merge`: the customer `mergedAccountId` is folded into `keptAccountId` (one record
 * for the group, ADR 0008). Its sites, its relationships with companies the kept customer has none
 * with, its contacts (its owner as another contact, since a customer has one owner) with their
 * consents, its leads with their tasks and tags, and its timeline move; it is archived; and the
 * merge is recorded in `customer_merges` with every id it moved, so `crm.customer.unmerge` can put
 * them back. Refused when a colleague looks after either customer in any of its companies, or any
 * of the merged customer's leads (`customer_held_by_colleague`, SECURITY §4), and for a referral
 * partner. Made from a card, the card is closed as merged.
 */
export const mergeCustomers = defineCommand({
  name: 'crm.customer.merge',
  permission: 'crm.lead.merge',
  minScope: 'team',
  alsoRequires: [{ permission: 'crm.account.write', minScope: 'own' }],
  peopleOnly: true,
  input: MergeCustomersInput,
  output: CustomerMergeDto,
  auditFields: [
    'movedContacts',
    'movedSites',
    'movedRelationships',
    'movedLeads',
    'movedTasks',
    'movedTags',
    'movedConsents',
    'movedActivities',
    'archivedAt',
    'state',
  ],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const candidate = await candidateOfPair(ctx, input.entityId, input.candidateId, 'customer', [
      input.keptAccountId,
      input.mergedAccountId,
    ]);
    // Decided before the merge, while the policies still show both customers.
    if (candidate !== undefined) await decideCandidate(ctx, candidate, 'merge');
    const mergeId = newId();
    const [answer] = (await ctx.tx.execute(sql`
      select app.merge_customers(${mergeId}::uuid, ${input.keptAccountId}::uuid,
        ${input.mergedAccountId}::uuid, ${input.entityId}::smallint,
        ${candidate?.id ?? null}::uuid) as result`)) as unknown as {
      result: { status: string; moved?: unknown };
    }[];
    const result = answer?.result;
    if (result?.status !== 'merged') throw refusal(result?.status ?? 'missing');
    const moved = movedCounts(result.moved);

    await ctx.activity({
      type: 'customers_merged',
      accountId: input.keptAccountId,
      entityId: input.entityId,
      payload: { mergedAccountId: input.mergedAccountId, mergeId, leads: moved.leads },
    });
    ctx.audit({
      aggregateType: 'customer',
      aggregateId: input.keptAccountId,
      entityId: input.entityId,
      before: null,
      after: { mergeId, mergedAccountId: input.mergedAccountId, ...movedFields(moved) },
    });
    ctx.audit({
      aggregateType: 'customer',
      aggregateId: input.mergedAccountId,
      entityId: input.entityId,
      before: { archivedAt: null },
      after: { archivedAt: ctx.now.toISOString(), mergeId },
    });
    return CustomerMergeDto.parse({
      id: mergeId,
      entityId: input.entityId,
      keptAccountId: input.keptAccountId,
      mergedAccountId: input.mergedAccountId,
      moved,
      undoneAt: null,
    });
  },
});

/**
 * `crm.customer.unmerge`: what a merge moved goes back to the customer it came from, which is no
 * longer archived; a row changed since stays where it is now (`app.unmerge_customers()`), and the
 * answer counts what actually came back. The card the merge was made from opens again. Refused
 * under the same rule as the merge, and while the kept customer has since been merged into another
 * (`merge_undo_later_first`: that merge is undone first).
 */
export const unmergeCustomers = defineCommand({
  name: 'crm.customer.unmerge',
  permission: 'crm.lead.merge',
  minScope: 'team',
  alsoRequires: [{ permission: 'crm.account.write', minScope: 'own' }],
  peopleOnly: true,
  input: UnmergeCustomersInput,
  output: CustomerMergeDto,
  auditFields: ['undoneAt', 'archivedAt', 'state'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const [answer] = (await ctx.tx.execute(sql`
      select app.unmerge_customers(${input.mergeId}::uuid) as result`)) as unknown as {
      result: {
        status: string;
        keptAccountId?: string;
        mergedAccountId?: string;
        candidateId?: string | null;
        entityId?: number;
        moved?: unknown;
      };
    }[];
    const result = answer?.result;
    if (result?.status !== 'undone') throw refusal(result?.status ?? 'missing');
    const kept = z.string().parse(result.keptAccountId);
    const merged = z.string().parse(result.mergedAccountId);
    const mergeEntity = z.number().int().parse(result.entityId);
    if (typeof result.candidateId === 'string') {
      const candidate = await lockCandidate(ctx, mergeEntity, result.candidateId);
      if (candidate.state === 'merged') await decideCandidate(ctx, candidate, 'unmerge');
    }
    // The row goes on whichever customer is still related to the company it was undone from.
    const onKept = await relatedHere(ctx, kept, input.entityId);
    const onMerged = !onKept && (await relatedHere(ctx, merged, input.entityId));
    if (onKept || onMerged) {
      await ctx.activity({
        type: 'customer_unmerged',
        accountId: onKept ? kept : merged,
        entityId: input.entityId,
        payload: { keptAccountId: kept, mergedAccountId: merged, mergeId: input.mergeId },
      });
    }
    const undoneAt = ctx.now.toISOString();
    ctx.audit({
      aggregateType: 'customer_merge',
      aggregateId: input.mergeId,
      entityId: mergeEntity,
      before: { undoneAt: null },
      after: { undoneAt, keptAccountId: kept, mergedAccountId: merged },
    });
    ctx.audit({
      aggregateType: 'customer',
      aggregateId: merged,
      entityId: mergeEntity,
      before: null,
      after: { archivedAt: null, mergeId: input.mergeId },
    });
    return CustomerMergeDto.parse({
      id: input.mergeId,
      entityId: mergeEntity,
      keptAccountId: kept,
      mergedAccountId: merged,
      moved: movedCounts(result.moved),
      undoneAt,
    });
  },
});

/**
 * `crm.lead.merge`: two open or nurture leads of one customer and one segment in one company become
 * one. The merged lead's open tasks and its tags move to the kept lead and the merged lead is closed
 * (archived); its timeline stays with the customer (`app.merge_leads()`). A referral partner of the
 * merged lead goes to a kept lead with none, so the partner keeps the credit for a win (CRM-09).
 * Refused for leads of two customers (`merge_customers_first`: the customers are merged first), of
 * two segments (`merge_leads_other_segment`) or of two referral partners
 * (`merge_leads_two_partners`: a person closes the one that should not count). Of an open lead and
 * a lead in nurture, the open one is kept (`merge_leads_keep_open` otherwise). The merged lead's open
 * nurture calls are cancelled first (`cancelCallTasks`, T1), so the kept lead never gets a second
 * set, or nurture calls while it is open; its callbacks move with its other tasks, and its calls
 * stay with it. Made from a card, the card is closed as merged.
 */
export const mergeLeads = defineCommand({
  name: 'crm.lead.merge',
  permission: 'crm.lead.merge',
  minScope: 'team',
  alsoRequires: [{ permission: 'crm.lead.write', minScope: 'own' }],
  peopleOnly: true,
  input: MergeLeadsInput,
  output: LeadMergeDto,
  auditFields: ['movedTasks', 'movedTags', 'archivedAt', 'state'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const candidate = await candidateOfPair(ctx, input.entityId, input.candidateId, 'lead', [
      input.keptOpportunityId,
      input.mergedOpportunityId,
    ]);
    if (candidate !== undefined) await decideCandidate(ctx, candidate, 'merge');
    // Before the definer moves the merged lead's open tasks, while its nurture calls are still its
    // own; a refused merge rolls these back with the rest.
    await cancelCallTasks(ctx, { id: input.mergedOpportunityId, entityId: input.entityId }, [
      'nurture',
    ]);
    const [answer] = (await ctx.tx.execute(sql`
      select app.merge_leads(${input.keptOpportunityId}::uuid, ${input.mergedOpportunityId}::uuid,
        ${input.entityId}::smallint) as result`)) as unknown as {
      result: {
        status: string;
        accountId?: string;
        tasks?: number;
        tags?: number;
        referralPartnerId?: string | null;
      };
    }[];
    const result = answer?.result;
    if (result?.status !== 'merged') {
      throw result?.status === 'missing'
        ? new DomainError('not_found', 'a lead of the pair is not available', {
            reason: 'lead_missing',
          })
        : refusal(result?.status ?? 'missing');
    }
    const accountId = z.string().parse(result.accountId);
    const tasks = z.number().int().min(0).parse(result.tasks);
    const tags = z.number().int().min(0).parse(result.tags);
    const referralPartnerId = z
      .string()
      .nullable()
      .parse(result.referralPartnerId ?? null);
    await ctx.activity({
      type: 'leads_merged',
      opportunityId: input.keptOpportunityId,
      accountId,
      entityId: input.entityId,
      payload: { mergedOpportunityId: input.mergedOpportunityId, tasks, tags },
    });
    ctx.audit({
      aggregateType: 'opportunity',
      aggregateId: input.keptOpportunityId,
      entityId: input.entityId,
      before: null,
      after: {
        mergedOpportunityId: input.mergedOpportunityId,
        movedTasks: tasks,
        movedTags: tags,
        ...(referralPartnerId === null ? {} : { referralPartnerId }),
      },
    });
    ctx.audit({
      aggregateType: 'opportunity',
      aggregateId: input.mergedOpportunityId,
      entityId: input.entityId,
      before: { archivedAt: null },
      after: { archivedAt: ctx.now.toISOString(), keptOpportunityId: input.keptOpportunityId },
    });
    return LeadMergeDto.parse({
      entityId: input.entityId,
      keptOpportunityId: input.keptOpportunityId,
      mergedOpportunityId: input.mergedOpportunityId,
      moved: { tasks, tags },
      referralPartnerId,
    });
  },
});
