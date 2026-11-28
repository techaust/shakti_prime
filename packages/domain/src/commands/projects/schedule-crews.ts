import { CrewDto, DomainError, newId, SaveCrewInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import { peopleOfCompany } from './schedule-shared';

/**
 * `projects.crew.save` (J5, docs/03-roadmap-appendix/phase4.md §7.2, §14): a new crew of the
 * company or a change to one, with its name, its lead and its members (each a person of the
 * company, the lead among them; the list replaces the one before); archived, it leaves the board
 * and takes no new visit. For the company's schedulers; people only.
 */
export const saveCrew = defineCommand({
  name: 'projects.crew.save',
  permission: 'projects.schedule.write',
  minScope: 'entity',
  peopleOnly: true,
  input: SaveCrewInput,
  output: CrewDto,
  auditFields: ['crewName', 'memberIds', 'crewArchived'],
  constraintReasons: { crews_entity_name_unique: 'crew_name_taken' },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    if (!(await peopleOfCompany(ctx.tx, input.entityId, input.memberIds))) {
      throw new DomainError('validation_failed', 'a person outside the company', {
        reason: 'crew_person_outside',
      });
    }
    const c = schema.crews;
    const m = schema.crewMembers;
    const archivedAt = input.archived ? ctx.now : null;
    let crew: typeof c.$inferSelect;
    let before: {
      crewName: string;
      leadId: string;
      memberIds: string[];
      crewArchived: boolean;
    } | null = null;
    if (input.crewId === null) {
      const [made] = await ctx.tx
        .insert(c)
        .values({
          id: newId(),
          entityId: input.entityId,
          name: input.name,
          leadId: input.leadId,
          archivedAt,
          createdBy: ctx.principal.id,
        })
        .returning();
      if (!made) throw new DomainError('internal', 'crew insert returned no row');
      crew = made;
    } else {
      const [current] = await ctx.tx
        .select()
        .from(c)
        .where(and(eq(c.id, input.crewId), eq(c.entityId, input.entityId)))
        .limit(1)
        .for('update');
      if (!current)
        throw new DomainError('not_found', 'crew not found', { reason: 'crew_missing' });
      const members = await ctx.tx
        .select({ personId: m.personId })
        .from(m)
        .where(eq(m.crewId, current.id))
        .orderBy(asc(m.personId));
      before = {
        crewName: current.name,
        leadId: current.leadId,
        memberIds: members.map((r) => r.personId),
        crewArchived: current.archivedAt !== null,
      };
      const [changed] = await ctx.tx
        .update(c)
        .set({
          name: input.name,
          leadId: input.leadId,
          // An archived crew keeps the day it was archived.
          archivedAt: input.archived ? (current.archivedAt ?? ctx.now) : null,
          updatedBy: ctx.principal.id,
        })
        .where(eq(c.id, current.id))
        .returning();
      if (!changed)
        throw new DomainError('not_found', 'crew not found', { reason: 'crew_missing' });
      crew = changed;
    }
    const had = before?.memberIds ?? [];
    const leaving = had.filter((id) => !input.memberIds.includes(id));
    const joining = input.memberIds.filter((id) => !had.includes(id));
    if (leaving.length > 0) {
      await ctx.tx.delete(m).where(and(eq(m.crewId, crew.id), inArray(m.personId, leaving)));
    }
    if (joining.length > 0) {
      await ctx.tx.insert(m).values(
        joining.map((personId) => ({
          id: newId(),
          entityId: crew.entityId,
          crewId: crew.id,
          personId,
          createdBy: ctx.principal.id,
        })),
      );
    }
    const memberIds = [...input.memberIds].sort();
    ctx.audit({
      aggregateType: 'crew',
      aggregateId: crew.id,
      entityId: crew.entityId,
      before,
      after: {
        crewName: crew.name,
        leadId: crew.leadId,
        memberIds,
        crewArchived: crew.archivedAt !== null,
      },
    });
    return CrewDto.parse({
      id: crew.id,
      entityId: crew.entityId,
      name: crew.name,
      leadId: crew.leadId,
      memberIds,
      archivedAt: crew.archivedAt?.toISOString() ?? null,
    });
  },
});
