import { DomainError, ScheduleSlotDto, type ScheduleConflictDto } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { isPerson } from '../../command/run-command';
import {
  findScheduleConflicts,
  travelFromPrevious,
  type AwayFact,
  type GeoPoint,
  type VisitFact,
} from '../../projects/schedule';
import type { Actor } from '../../state-machines/define-machine';
import {
  SCHEDULE_SLOT_STATES,
  type ScheduleSlotMachineState,
} from '../../state-machines/machines/schedule-slot';
import { requireEntity } from '../crm/opportunity-shared';

/**
 * What the scheduling board's commands share (J5, docs/03-roadmap-appendix/phase4.md §7.2): the
 * visit locked as the caller may write it, the people a visit holds, the facts the conflict check
 * reads, and the rule for saving over a conflict.
 */

export type SlotRow = typeof schema.scheduleSlots.$inferSelect;

/** Every key a visit command's audit row records besides ids (`apps/web/src/screens/audit.ts`). */
export const SLOT_AUDIT_FIELDS = [
  'slotState',
  'startsAt',
  'endsAt',
  'travelMin',
  'overrideReason',
  'conflicts',
  'cancelReason',
  'doneNote',
] as const;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** The actor a person's or agent's command fires the machine as. */
export function slotActor(ctx: CommandContext): Actor {
  return { kind: 'principal', principal: ctx.principal };
}

export function slotState(row: SlotRow): ScheduleSlotMachineState {
  const state = SCHEDULE_SLOT_STATES.find((s) => s === row.state);
  if (state === undefined) throw new DomainError('internal', `unknown visit state ${row.state}`);
  return state;
}

/**
 * The visit, locked for this transaction, as the caller reads it: one of another company or one
 * the caller cannot read is not found. Writing it is then the update policy's call.
 */
export async function lockSlot(
  ctx: CommandContext,
  entityId: number,
  slotId: string,
): Promise<SlotRow> {
  requireEntity(ctx, entityId);
  const s = schema.scheduleSlots;
  const [row] = await ctx.tx
    .select()
    .from(s)
    .where(and(eq(s.id, slotId), eq(s.entityId, entityId)))
    .limit(1)
    .for('update');
  if (!row) throw new DomainError('not_found', 'visit not found', { reason: 'slot_missing' });
  return row;
}

/** Writes the visit's new values as the caller; a row the update policy refuses is not found. */
export async function writeSlot(
  ctx: CommandContext,
  row: SlotRow,
  values: Partial<Omit<SlotRow, 'id' | 'entityId' | 'createdAt' | 'createdBy'>>,
): Promise<SlotRow> {
  const [written] = await ctx.tx
    .update(schema.scheduleSlots)
    .set({ ...values, updatedBy: ctx.principal.id })
    .where(eq(schema.scheduleSlots.id, row.id))
    .returning();
  if (!written) throw new DomainError('not_found', 'visit not found', { reason: 'slot_missing' });
  return written;
}

/** The visit as its commands answer it, with the conflicts this save went over. */
export function slotDto(
  row: SlotRow,
  conflicts: readonly ScheduleConflictDto[] = [],
): ScheduleSlotDto {
  return ScheduleSlotDto.parse({
    id: row.id,
    entityId: row.entityId,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    engineerId: row.engineerId,
    crewId: row.crewId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    travelMin: row.travelMin,
    state: row.state,
    proposedBy: row.proposedBy,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confirmedBy: row.confirmedBy,
    doneAt: row.doneAt?.toISOString() ?? null,
    doneBy: row.doneBy,
    doneNote: row.doneNote,
    cancelReason: row.cancelReason,
    overrideReason: row.overrideReason,
    conflicts,
  });
}

/** A crew of the company still on the board, with its members; not found otherwise. */
export async function crewPeople(
  tx: RequestTx,
  entityId: number,
  crewId: string,
): Promise<string[]> {
  const c = schema.crews;
  const [crew] = await tx
    .select({ id: c.id, archivedAt: c.archivedAt })
    .from(c)
    .where(and(eq(c.id, crewId), eq(c.entityId, entityId)))
    .limit(1);
  if (!crew || crew.archivedAt !== null) {
    throw new DomainError('not_found', 'crew not found', { reason: 'crew_missing' });
  }
  const m = schema.crewMembers;
  const members = await tx
    .select({ personId: m.personId })
    .from(m)
    .where(eq(m.crewId, crewId))
    .orderBy(asc(m.personId));
  return members.map((r) => r.personId);
}

/** Whether every one of `people` holds a role in the company. */
export async function peopleOfCompany(
  tx: RequestTx,
  entityId: number,
  people: readonly string[],
): Promise<boolean> {
  if (people.length === 0) return true;
  const r = schema.userEntityRoles;
  const found = await tx
    .selectDistinct({ userId: r.userId })
    .from(r)
    .where(
      and(eq(r.entityId, entityId), sql`${r.userId} = any(${`{${people.join(',')}}`}::uuid[])`),
    );
  return found.length === new Set(people).size;
}

/**
 * Holds each person's schedule for the rest of the transaction, in a fixed order, so two visits
 * saved at once for one person cannot both pass the conflict check.
 */
export async function lockPeople(tx: RequestTx, people: readonly string[]): Promise<void> {
  for (const id of [...new Set(people)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`schedule:${id}`}, 0))`);
  }
}

const pointOf = (lat: string | null, lng: string | null): GeoPoint | null =>
  lat === null || lng === null ? null : { lat: Number(lat), lng: Number(lng) };

/** The sites of the projects the caller reads (`app.schedule_site_points()`). */
export async function sitePoints(
  tx: RequestTx,
  projectIds: readonly string[],
): Promise<Map<string, GeoPoint | null>> {
  const points = new Map<string, GeoPoint | null>();
  if (projectIds.length === 0) return points;
  const rows = (await tx.execute(
    sql`select project_id::text as project_id, lat::text as lat, lng::text as lng
          from app.schedule_site_points(${`{${[...new Set(projectIds)].join(',')}}`}::uuid[])`,
  )) as unknown as { project_id: string; lat: string | null; lng: string | null }[];
  for (const r of rows) points.set(r.project_id, pointOf(r.lat, r.lng));
  return points;
}

/** The people's visits not cancelled and their time away (`app.schedule_busy()`), in every company. */
export async function busyFacts(
  tx: RequestTx,
  people: readonly string[],
  from: Date,
  to: Date,
): Promise<{ visits: VisitFact[]; away: AwayFact[] }> {
  if (people.length === 0) return { visits: [], away: [] };
  const rows = (await tx.execute(
    sql`select person_id::text as person_id, kind, item_id::text as item_id, starts_at, ends_at,
               lat::text as lat, lng::text as lng, away_kind
          from app.schedule_busy(${`{${[...new Set(people)].join(',')}}`}::uuid[],
                                 ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`,
  )) as unknown as {
    person_id: string;
    kind: 'slot' | 'away';
    item_id: string;
    starts_at: Date | string;
    ends_at: Date | string;
    lat: string | null;
    lng: string | null;
    away_kind: 'leave' | 'training' | 'other' | null;
  }[];
  const visits = new Map<string, VisitFact & { personIds: string[] }>();
  const away: AwayFact[] = [];
  for (const r of rows) {
    const startsAt = new Date(r.starts_at);
    const endsAt = new Date(r.ends_at);
    if (r.kind === 'away') {
      away.push({
        id: r.item_id,
        personId: r.person_id,
        startsAt,
        endsAt,
        kind: r.away_kind ?? 'other',
      });
      continue;
    }
    const known = visits.get(r.item_id);
    if (known) {
      if (!known.personIds.includes(r.person_id)) known.personIds.push(r.person_id);
    } else {
      visits.set(r.item_id, {
        id: r.item_id,
        personIds: [r.person_id],
        startsAt,
        endsAt,
        point: pointOf(r.lat, r.lng),
      });
    }
  }
  return { visits: [...visits.values()], away };
}

/** A visit as the conflict check is asked about it. */
export interface VisitPlan {
  slotId: string;
  entityId: number;
  projectId: string;
  engineerId: string | null;
  crewId: string | null;
  startsAt: Date;
  endsAt: Date;
}

/**
 * The conflicts of a visit as planned (`findScheduleConflicts()`, the only place they are named)
 * and its travel from the visit before, with every person on it held until the transaction ends.
 * The engineer must be a person of the company and the crew one still on the board.
 */
export async function checkVisit(
  ctx: CommandContext,
  plan: VisitPlan,
): Promise<{ conflicts: ScheduleConflictDto[]; travelMin: number | null }> {
  let people: string[];
  if (plan.engineerId !== null) {
    if (!(await peopleOfCompany(ctx.tx, plan.entityId, [plan.engineerId]))) {
      throw new DomainError('validation_failed', 'the engineer is not of the company', {
        reason: 'schedule_slot_person_outside',
      });
    }
    people = [plan.engineerId];
  } else if (plan.crewId !== null) {
    people = await crewPeople(ctx.tx, plan.entityId, plan.crewId);
  } else {
    throw new DomainError('validation_failed', 'a visit needs an engineer or a crew', {
      reason: 'slot_assignee_required',
    });
  }
  await lockPeople(ctx.tx, people);
  const point = (await sitePoints(ctx.tx, [plan.projectId])).get(plan.projectId) ?? null;
  const facts = await busyFacts(
    ctx.tx,
    people,
    new Date(plan.startsAt.getTime() - DAY_MS),
    new Date(plan.endsAt.getTime() + DAY_MS),
  );
  const slot: VisitFact = {
    id: plan.slotId,
    personIds: people,
    startsAt: plan.startsAt,
    endsAt: plan.endsAt,
    point,
  };
  return {
    conflicts: findScheduleConflicts(slot, facts.visits, facts.away),
    travelMin: travelFromPrevious(slot, facts.visits),
  };
}

/**
 * Saving over conflicts (question 6 (a)): a person may, with a reason, which the visit keeps and
 * the audit trail records with the conflicts named; an agent never may, so the Orchestrator only
 * proposes free times. Answers the reason to keep: null when there is no conflict.
 */
export function overrideFor(
  ctx: CommandContext,
  conflicts: readonly ScheduleConflictDto[],
  overrideReason: string | null,
): string | null {
  if (conflicts.length === 0) return null;
  if (overrideReason === null || !isPerson(ctx.principal)) {
    throw new DomainError('conflict', 'the visit clashes with another booking', {
      reason: 'schedule_conflict',
      conflicts,
    });
  }
  return overrideReason;
}

/** What the audit row records of a visit's time and conflicts. */
export function slotAudit(row: SlotRow, conflicts: readonly ScheduleConflictDto[] = []) {
  return {
    slotState: row.state,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    travelMin: row.travelMin,
    engineerId: row.engineerId,
    crewId: row.crewId,
    overrideReason: conflicts.length === 0 ? null : row.overrideReason,
    conflicts: [...conflicts],
  };
}
