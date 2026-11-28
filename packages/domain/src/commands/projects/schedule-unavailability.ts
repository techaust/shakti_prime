import {
  DomainError,
  newId,
  RecordUnavailabilityInput,
  RemoveUnavailabilityInput,
  UnavailabilityDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import { peopleOfCompany } from './schedule-shared';

/**
 * A person's time away on the scheduling board (J5, docs/03-roadmap-appendix/phase4.md §2,
 * "Unavailability before leave exists"): leave, training or other, recorded and removed by the
 * company's schedulers, people only. The board's conflict check reads it; visits already booked
 * over it show their conflict there. Phase 5's approved leave writes into the same table.
 */

const UNAVAILABILITY_AUDIT_FIELDS = ['awayKind', 'startsAt', 'endsAt', 'note'] as const;

type UnavailabilityRow = typeof schema.unavailability.$inferSelect;

function unavailabilityDto(row: UnavailabilityRow): UnavailabilityDto {
  return UnavailabilityDto.parse({
    id: row.id,
    entityId: row.entityId,
    personId: row.personId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    kind: row.kind,
    note: row.note,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  });
}

const auditOf = (row: UnavailabilityRow) => ({
  personId: row.personId,
  awayKind: row.kind,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  note: row.note,
});

/** `projects.unavailability.record`: a person of the company away from a start to an end. */
export const recordUnavailability = defineCommand({
  name: 'projects.unavailability.record',
  permission: 'projects.schedule.write',
  minScope: 'entity',
  peopleOnly: true,
  input: RecordUnavailabilityInput,
  output: UnavailabilityDto,
  auditFields: [...UNAVAILABILITY_AUDIT_FIELDS],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    if (!(await peopleOfCompany(ctx.tx, input.entityId, [input.personId]))) {
      throw new DomainError('validation_failed', 'a person outside the company', {
        reason: 'unavailability_person_outside',
      });
    }
    const [row] = await ctx.tx
      .insert(schema.unavailability)
      .values({
        id: newId(),
        entityId: input.entityId,
        personId: input.personId,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        kind: input.kind,
        note: input.note,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'unavailability insert returned no row');
    ctx.audit({
      aggregateType: 'unavailability',
      aggregateId: row.id,
      entityId: row.entityId,
      after: auditOf(row),
    });
    return unavailabilityDto(row);
  },
});

/** `projects.unavailability.remove`: a time away recorded in error, or no longer taken. */
export const removeUnavailability = defineCommand({
  name: 'projects.unavailability.remove',
  permission: 'projects.schedule.write',
  minScope: 'entity',
  peopleOnly: true,
  input: RemoveUnavailabilityInput,
  output: UnavailabilityDto,
  auditFields: [...UNAVAILABILITY_AUDIT_FIELDS],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const u = schema.unavailability;
    const [row] = await ctx.tx
      .delete(u)
      .where(and(eq(u.id, input.unavailabilityId), eq(u.entityId, input.entityId)))
      .returning();
    if (!row) {
      throw new DomainError('not_found', 'time away not found', {
        reason: 'unavailability_missing',
      });
    }
    ctx.audit({
      aggregateType: 'unavailability',
      aggregateId: row.id,
      entityId: row.entityId,
      before: auditOf(row),
    });
    return unavailabilityDto(row);
  },
});
