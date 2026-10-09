import {
  CustomerLanguageSchema,
  DomainError,
  newId,
  ReassignAllDto,
  ReassignAllInput,
  SegmentSchema,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { pickConverter } from '../../crm/handover';
import { assignOpportunity } from './assign-opportunity';
import { loadCandidates } from './hand-over-lead';
import { requireEntity } from './opportunity-shared';

/** How many leads one `crm.lead.reassign_all` moves; a longer list takes a second run. */
export const REASSIGN_ALL_LIMIT = 500;

interface LeadRow {
  id: string;
  state: string;
  segment: string;
  language: string;
}

/**
 * `crm.lead.reassign_all` (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2): every open and nurtured lead
 * of a leaving caller in one company goes to one named person, or in turn to the Lead Converters
 * who qualify for each lead (`toUserId` null, `pickConverter()`, each pick counting the leads
 * already given out). Each lead moves through `crm.opportunity.assign`, so it carries the lock,
 * its callbacks and nurture calls, the customer relationship (the caller's own, when the leaver
 * held it) and the new owner's notice. The caller sees and moves only the leads their own scope
 * covers: a Sales Team Lead the team's, a General Manager the company's, an Executive any.
 * Refuses a target who is not active in the company, or a round that finds no converter present;
 * answers how many leads moved, at most `REASSIGN_ALL_LIMIT` a run.
 */
export const reassignAllLeads = defineCommand({
  name: 'crm.lead.reassign_all',
  permission: 'crm.lead.assign',
  minScope: 'team',
  alsoRequires: [{ permission: 'crm.lead.write', minScope: 'own' }],
  peopleOnly: true,
  input: ReassignAllInput,
  output: ReassignAllDto,
  auditFields: ['movedLeads'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    if (input.toUserId === input.fromUserId) {
      throw new DomainError('validation_failed', 'the leads would stay with their owner', {
        reason: 'reassign_same_person',
      });
    }
    const candidates = (await loadCandidates(ctx, input.entityId)).filter(
      (c) => c.userId !== input.fromUserId,
    );
    if (input.toUserId !== null && !candidates.some((c) => c.userId === input.toUserId)) {
      throw new DomainError('validation_failed', 'the new owner does not work on leads here', {
        reason: 'assignee_not_eligible',
      });
    }

    const leads = (await ctx.tx.execute(
      sql`select o.id, o.state, p.segment,
                 coalesce((select c.preferred_language
                             from account_contacts ac join contacts c on c.id = ac.contact_id
                            where ac.account_id = o.account_id
                            order by (ac.role = 'owner') desc, ac.created_at, ac.contact_id
                            limit 1), 'hinglish') as language
            from opportunities o join pipelines p on p.id = o.pipeline_id
           where o.entity_id = ${input.entityId}::smallint
             and o.owner_id = ${input.fromUserId}::uuid
             and o.state in ('open', 'nurture')
             and o.archived_at is null
           order by o.id
           limit ${REASSIGN_ALL_LIMIT}`,
    )) as unknown as LeadRow[];

    let moved = 0;
    let cursor: string | null = null;
    for (const lead of leads) {
      let ownerId = input.toUserId;
      if (ownerId === null) {
        ownerId = pickConverter(
          candidates,
          {
            language: CustomerLanguageSchema.parse(lead.language),
            segment: SegmentSchema.parse(lead.segment),
          },
          cursor,
        );
        if (ownerId === null) {
          throw new DomainError('conflict', 'no Lead Converter is present to take these leads', {
            reason: 'reassign_no_converter',
          });
        }
        cursor = ownerId;
        const taker = candidates.find((c) => c.userId === ownerId);
        if (taker !== undefined && lead.state === 'open') taker.openLeads += 1;
      }
      await ctx.run(assignOpportunity, {
        entityId: input.entityId,
        opportunityId: lead.id,
        ownerId,
      });
      moved += 1;
    }
    ctx.audit({
      aggregateType: 'lead_reassignment',
      aggregateId: newId(),
      entityId: input.entityId,
      before: null,
      after: { movedLeads: moved },
    });
    return { entityId: input.entityId, moved };
  },
});
