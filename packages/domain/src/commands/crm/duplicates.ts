import {
  DismissDuplicateInput,
  DomainError,
  DuplicateCandidateDto,
  DuplicateScanDto,
  newId,
  ScanDuplicatesInput,
  SuggestDuplicateInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { duplicateConfidence } from '../../crm/duplicate-confidence';
import { DUPLICATE_SCAN_BATCH, findDuplicates, recordDuplicates } from '../../crm/duplicates';
import { transition } from '../../state-machines/define-machine';
import {
  duplicateCandidateMachine,
  type DuplicateCandidateEvent,
  type DuplicateCandidateMachineState,
} from '../../state-machines/machines/duplicate-candidate';
import { requireEntity } from './opportunity-shared';

type CandidateRow = typeof schema.duplicateCandidates.$inferSelect;

/** The candidate as a command answers it. */
export function candidateDto(row: CandidateRow): DuplicateCandidateDto {
  return DuplicateCandidateDto.parse({
    id: row.id,
    entityId: row.entityId,
    kind: row.kind,
    state: row.state,
    reason: row.reason,
    confidence: row.confidence,
  });
}

/**
 * The candidate, locked for this transaction, when the caller may decide it (the update policy:
 * a person holding `crm.lead.merge` who sees both sides); otherwise not found.
 */
export async function lockCandidate(
  ctx: CommandContext,
  entityId: number,
  candidateId: string,
): Promise<CandidateRow> {
  const d = schema.duplicateCandidates;
  const [row] = await ctx.tx
    .select()
    .from(d)
    .where(and(eq(d.id, candidateId), eq(d.entityId, entityId)))
    .limit(1)
    .for('update');
  if (!row) {
    throw new DomainError('not_found', `duplicate ${candidateId} is not visible`, {
      reason: 'duplicate_missing',
    });
  }
  return row;
}

/**
 * Moves a candidate through its machine and records who decided it: a merge or a dismissal sets
 * the person and the time, undoing a merge opens the card again and clears both.
 */
export async function decideCandidate(
  ctx: CommandContext,
  row: CandidateRow,
  event: DuplicateCandidateEvent,
): Promise<CandidateRow> {
  const step = transition(
    duplicateCandidateMachine,
    { state: row.state as DuplicateCandidateMachineState },
    event,
    { actor: { kind: 'principal', principal: ctx.principal }, now: ctx.now, params: undefined },
  );
  const open = step.to === 'open';
  const d = schema.duplicateCandidates;
  const [updated] = await ctx.tx
    .update(d)
    .set({
      state: step.to,
      decidedBy: open ? null : ctx.principal.id,
      decidedAt: open ? null : ctx.now,
      updatedBy: ctx.principal.id,
    })
    .where(eq(d.id, row.id))
    .returning();
  if (!updated) throw new DomainError('internal', `duplicate ${row.id} could not be updated`);
  ctx.audit({
    aggregateType: 'duplicate_candidate',
    aggregateId: row.id,
    entityId: row.entityId,
    before: { state: row.state },
    after: { state: updated.state },
  });
  return updated;
}

/**
 * `crm.duplicate.scan` (CRM-03): the next `DUPLICATE_SCAN_BATCH` customers of a company, in id
 * order after `afterId`, each looked around for other customers that share a number or a name and
 * village, and for two open leads of one segment; what is worth a card is recorded. It catches what
 * lead creation does not: two customers made at the same moment by an import and a form (imports
 * take no number lock, DECISIONS 28-09-2026), and rows an import committed in a batch. The nightly
 * worker runs it batch by batch as `system:workers`; it needs the platform-only
 * `crm.duplicates.scan`, which no person's role and no agent holds, and reaches customers and leads
 * only through the definers `app.duplicate_facts()` and `app.record_duplicates()` (ADR 0020). One
 * audit row records each batch that found something.
 */
export const scanDuplicates = defineCommand({
  name: 'crm.duplicate.scan',
  permission: 'crm.duplicates.scan',
  minScope: 'entity',
  input: ScanDuplicatesInput,
  output: DuplicateScanDto,
  auditFields: ['rows'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const found = await findDuplicates(ctx, input.entityId, {
      afterId: input.afterId,
      limit: DUPLICATE_SCAN_BATCH,
    });
    const recorded = await recordDuplicates(ctx, input.entityId, found.pairs);
    if (recorded.length > 0) {
      ctx.audit({
        aggregateType: 'duplicate_batch',
        aggregateId: newId(),
        entityId: input.entityId,
        before: null,
        after: { rows: recorded.length },
      });
    }
    return DuplicateScanDto.parse({
      entityId: input.entityId,
      found: recorded.length,
      nextAfterId: found.subjects === DUPLICATE_SCAN_BATCH ? found.lastSubjectId : null,
    });
  },
});

/** `crm.duplicate.dismiss`: a person says the pair is not the same; the card closes for good. */
export const dismissDuplicate = defineCommand({
  name: 'crm.duplicate.dismiss',
  permission: 'crm.lead.merge',
  minScope: 'team',
  peopleOnly: true,
  input: DismissDuplicateInput,
  output: DuplicateCandidateDto,
  auditFields: ['state'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockCandidate(ctx, input.entityId, input.candidateId);
    return candidateDto(await decideCandidate(ctx, row, 'dismiss'));
  },
});

/**
 * `crm.duplicate.suggest`: two open leads of one customer and segment in one company put forward as
 * one, with the confidence `duplicateConfidence()` gives them. The one duplicate step an agent may
 * take (SECURITY §3.3: the Triage agent holds `crm.lead.merge` to suggest only; every merge is for
 * people). It sees only what the caller's policies let it read, so it suggests only what it can
 * check: two leads of one customer. A pair already put forward is answered as it stands.
 */
export const suggestDuplicate = defineCommand({
  name: 'crm.duplicate.suggest',
  permission: 'crm.lead.merge',
  minScope: 'team',
  input: SuggestDuplicateInput,
  output: DuplicateCandidateDto,
  auditFields: ['confidence', 'duplicateReason'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const o = schema.opportunities;
    const p = schema.pipelines;
    const leads = await ctx.tx
      .select({ id: o.id, accountId: o.accountId, state: o.state, segment: p.segment })
      .from(o)
      .innerJoin(p, eq(p.id, o.pipelineId))
      .where(
        and(
          inArray(o.id, [input.opportunityId, input.otherOpportunityId]),
          eq(o.entityId, input.entityId),
          isNull(o.archivedAt),
        ),
      );
    if (leads.length !== 2) {
      throw new DomainError('not_found', 'a lead of the pair is not visible', {
        reason: 'lead_missing',
      });
    }
    const [first, second] = [...leads].sort((a, b) => (a.id < b.id ? -1 : 1));
    if (first === undefined || second === undefined) throw new DomainError('internal', 'no pair');
    const sameCustomer = first.accountId === second.accountId;
    const found =
      sameCustomer &&
      first.segment === second.segment &&
      first.state === 'open' &&
      second.state === 'open'
        ? duplicateConfidence({
            kind: 'lead',
            samePhone: true,
            sameName: false,
            sameVillage: false,
            sameCustomer,
          })
        : undefined;
    if (found === undefined) {
      throw new DomainError(
        'validation_failed',
        'the leads are not two open leads of one enquiry',
        {
          reason: 'duplicate_not_matching',
        },
      );
    }
    const d = schema.duplicateCandidates;
    const [inserted] = await ctx.tx
      .insert(d)
      .values({
        id: newId(),
        entityId: input.entityId,
        kind: 'lead',
        opportunityId: first.id,
        otherOpportunityId: second.id,
        reason: found.reason,
        signalsJson: found.signals,
        confidence: found.confidence,
        createdBy: ctx.principal.id,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      ctx.audit({
        aggregateType: 'duplicate_candidate',
        aggregateId: inserted.id,
        entityId: input.entityId,
        before: null,
        after: { confidence: found.confidence, duplicateReason: found.reason },
      });
      ctx.emit({
        type: 'crm.duplicate.found',
        entityId: input.entityId,
        aggregateType: 'duplicate_candidate',
        aggregateId: inserted.id,
        payload: { kind: 'lead', reason: found.reason, confidence: found.confidence },
      });
      return candidateDto(inserted);
    }
    const [existing] = await ctx.tx
      .select()
      .from(d)
      .where(
        and(eq(d.kind, 'lead'), eq(d.opportunityId, first.id), eq(d.otherOpportunityId, second.id)),
      )
      .limit(1);
    if (!existing) throw new DomainError('internal', 'the pair was neither written nor found');
    return candidateDto(existing);
  },
});
