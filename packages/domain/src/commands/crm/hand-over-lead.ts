import {
  CustomerLanguageSchema,
  DomainError,
  HandOverLeadDto,
  HandOverLeadInput,
  SegmentSchema,
  type CallerPresence,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import type { CommandContext } from '../../command/context';
import { pickConverter, type ConverterCandidate } from '../../crm/handover';
import { transition } from '../../state-machines/define-machine';
import { opportunityMachine } from '../../state-machines/machines/opportunity';
import { requireEntity } from './opportunity-shared';

interface LeadFacts {
  state: string;
  owner_id: string | null;
  team_id: string | null;
  account_id: string;
  segment: string;
  language: string;
}

export interface CandidateRow {
  user_id: string;
  team_id: string | null;
  is_converter: boolean;
  presence: string;
  max_open: number | null;
  languages: string[];
  segments: string[];
  open_leads: number;
}

interface AssignRow {
  status: 'assigned' | 'already' | 'not_open' | 'not_eligible' | 'missing';
  previous_owner: string | null;
  previous_team: string | null;
  team_id: string | null;
  locked_until: Date | string | null;
  lock_hours: number | null;
  moved: { oldId: string; newId: string; kind: string; dueAt: string }[];
}

/** The candidates the handover definer answers, as the pure picker reads them. */
export function toCandidates(rows: readonly CandidateRow[]): ConverterCandidate[] {
  return rows.map((r) => ({
    userId: r.user_id,
    isConverter: r.is_converter,
    presence: r.presence as CallerPresence,
    maxOpen: r.max_open,
    languages: r.languages.map((l) => CustomerLanguageSchema.parse(l)),
    segments: r.segments.map((s) => SegmentSchema.parse(s)),
    openLeads: r.open_leads,
  }));
}

/** The people who might take a lead in a company, with their profiles and open leads. */
export async function loadCandidates(
  ctx: Pick<CommandContext, 'tx'>,
  entityId: number,
): Promise<ConverterCandidate[]> {
  const rows = (await ctx.tx.execute(
    sql`select user_id, team_id, is_converter, presence, max_open, languages, segments, open_leads
          from app.handover_candidates(${entityId}::smallint)`,
  )) as unknown as CandidateRow[];
  return toCandidates(rows);
}

/**
 * `crm.opportunity.hand_over` (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2): the handover worker's
 * command for a lead that reached Qualified (`crm.opportunity.stage_moved` with `handover: true`).
 * It runs as `system:workers`, which holds only the platform-only `crm.handover.run` (ADR 0020)
 * and reaches the lead, the people and the inbox through definers that check it:
 *
 * - `pickConverter()` chooses the Lead Converter (present, under their cap, matching the
 *   customer's language and the pipeline's business line, fewest open leads, ties in turn after
 *   `cursor`);
 * - when none qualifies, the lead goes to the company's Sales Team Lead (the lead's team's own,
 *   else any) with routed work in their Agent Inbox;
 * - the lead is given over through the opportunity machine's `assign` (a lock for the pipeline's
 *   lock hours, the lead's callbacks and nurture calls to the new owner, its timeline), and the
 *   customer relationship moves to the new owner as a person's handover moves it (the owner's
 *   decision of 09-10-2026, `app.hand_over_customer()`); the new owner is told by the notify worker.
 *
 * The handover made for an event is made once: a repeat answers `already`, a lead no longer open
 * `not_open`, and neither changes anything.
 */
export const handOverLead = defineCommand({
  name: 'crm.opportunity.hand_over',
  permission: 'crm.handover.run',
  minScope: 'entity',
  input: HandOverLeadInput,
  output: HandOverLeadDto,
  auditFields: ['lockedUntil', 'state', 'dueAt'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const [facts] = (await ctx.tx.execute(
      sql`select state, owner_id, team_id, account_id, segment, language
            from app.handover_lead_facts(${input.entityId}::smallint, ${input.opportunityId}::uuid)`,
    )) as unknown as LeadFacts[];
    if (facts === undefined) {
      throw new DomainError('not_found', `opportunity ${input.opportunityId} is not found`, {
        reason: 'lead_missing',
      });
    }
    if (facts.state !== 'open') {
      return { outcome: 'not_open' as const, ownerId: facts.owner_id, cursor: input.cursor };
    }

    const pick = pickConverter(
      await loadCandidates(ctx, input.entityId),
      {
        language: CustomerLanguageSchema.parse(facts.language),
        segment: SegmentSchema.parse(facts.segment),
      },
      input.cursor,
    );
    let ownerId = pick;
    if (ownerId === null) {
      const [lead] = (await ctx.tx.execute(
        sql`select user_id from app.handover_team_lead(${input.entityId}::smallint, ${input.opportunityId}::uuid)`,
      )) as unknown as { user_id: string }[];
      if (lead === undefined) {
        return { outcome: 'no_one' as const, ownerId: facts.owner_id, cursor: input.cursor };
      }
      ownerId = lead.user_id;
    }

    // The machine's `assign`, fired as the platform: the lock never stops a handover.
    transition(
      opportunityMachine,
      {
        state: 'open',
        pipelineId: '',
        exitRequiredFields: [],
        fields: {},
        lockedUntil: null,
        stateChangedAt: null,
        hasAcceptedQuoteOrConfirmedOrder: false,
      },
      'assign',
      { actor: { kind: 'system', job: 'handover' }, now: ctx.now, params: {} },
    );

    const [assigned] = (await ctx.tx.execute(
      sql`select status, previous_owner, previous_team, team_id, locked_until, lock_hours, moved
            from app.handover_assign(${input.entityId}::smallint, ${input.opportunityId}::uuid,
                                     ${ownerId}::uuid, ${input.eventId}::uuid)`,
    )) as unknown as AssignRow[];
    if (assigned === undefined || assigned.status === 'missing') {
      throw new DomainError('not_found', `opportunity ${input.opportunityId} is not found`, {
        reason: 'lead_missing',
      });
    }
    if (assigned.status === 'already' || assigned.status === 'not_open') {
      return {
        outcome: assigned.status,
        ownerId: assigned.previous_owner,
        cursor: input.cursor,
      };
    }
    if (assigned.status === 'not_eligible') {
      throw new DomainError('validation_failed', 'the new owner does not work on leads here', {
        reason: 'assignee_not_eligible',
      });
    }

    const lockedUntil = new Date(assigned.locked_until ?? ctx.now).toISOString();
    const [moved] = (await ctx.tx.execute(
      sql`select status, relationship_id as "relationshipId", previous_team_id as "previousTeamId"
            from app.hand_over_customer(${input.opportunityId}::uuid, ${assigned.previous_owner}::uuid)`,
    )) as unknown as {
      status: string;
      relationshipId: string | null;
      previousTeamId: string | null;
    }[];
    if (moved?.status === 'moved' && moved.relationshipId !== null) {
      ctx.audit({
        aggregateType: 'account_entity',
        aggregateId: moved.relationshipId,
        entityId: input.entityId,
        before: { ownerId: assigned.previous_owner, teamId: moved.previousTeamId },
        after: { ownerId, teamId: assigned.team_id },
      });
    }
    for (const task of assigned.moved) {
      ctx.audit({
        aggregateType: 'task',
        aggregateId: task.oldId,
        entityId: input.entityId,
        before: { state: 'open' },
        after: { state: 'cancelled' },
      });
      ctx.audit({
        aggregateType: 'task',
        aggregateId: task.newId,
        entityId: input.entityId,
        before: null,
        after: { dueAt: new Date(task.dueAt).toISOString(), state: 'open' },
      });
    }
    ctx.audit({
      aggregateType: 'opportunity',
      aggregateId: input.opportunityId,
      entityId: input.entityId,
      before: { ownerId: assigned.previous_owner, teamId: assigned.previous_team },
      after: { ownerId, teamId: assigned.team_id, lockedUntil },
    });
    ctx.emit({
      type: 'crm.opportunity.assigned',
      entityId: input.entityId,
      aggregateType: 'opportunity',
      aggregateId: input.opportunityId,
      payload: {
        ownerId,
        teamId: assigned.team_id,
        lockHours: assigned.lock_hours ?? 48,
        assignedById: ctx.principal.id,
      },
    });
    if (pick === null) {
      const [item] = (await ctx.tx.execute(
        sql`select app.handover_route_to_team_lead(${input.entityId}::smallint,
              ${input.opportunityId}::uuid, ${ownerId}::uuid, ${assigned.team_id}::uuid) as id`,
      )) as unknown as { id: string | null }[];
      if (item?.id) {
        ctx.audit({
          aggregateType: 'inbox_item',
          aggregateId: item.id,
          entityId: input.entityId,
          before: null,
          after: { state: 'open' },
        });
      }
    }
    return pick === null
      ? { outcome: 'team_lead' as const, ownerId, cursor: input.cursor }
      : { outcome: 'converter' as const, ownerId, cursor: ownerId };
  },
});
