// HR1's journey fixtures (`e2e/hr.spec.ts`), written by the seed on the host as the table owner:
// the tele-caller and the team lead on company 1's staff, the tele-caller reporting to the team
// lead; per project a leave type of company 1 whose balance for the tele-caller is topped up to
// the starting days, so each project's balance is its own; the snapshot company's staff, for the
// directory's picture; and, per project, the first day after its latest request, so a run never
// asks for a day an earlier run took. Every name, day and figure here is a test value for these
// journeys alone, never a leave rule.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import { HR_JOURNEY, PROJECTS, SNAPSHOT_COMPANY, type ProjectName } from '../support/users';

type Sql = Parameters<Parameters<typeof asMigrator>[0]>[0];

interface StaffSpec {
  entityId: number;
  userId: string | null;
  name: string;
  managerId: string | null;
  office: string | null;
  joinedOn: string;
}

/** A staff record, found by its sign-in (or its name, for staff with none) and kept as specified. */
async function ensureEmployee(m: Sql, spec: StaffSpec, by: string): Promise<string> {
  const [found] =
    spec.userId === null
      ? await m<{ id: string }[]>`
          select id from employees
           where entity_id = ${spec.entityId} and user_id is null and name = ${spec.name}`
      : await m<{ id: string }[]>`
          select id from employees where entity_id = ${spec.entityId} and user_id = ${spec.userId}`;
  if (found) {
    await m`update employees
               set name = ${spec.name}, manager_id = ${spec.managerId}, office = ${spec.office},
                   joined_on = ${spec.joinedOn}, active = true, left_on = null, updated_by = ${by}
             where id = ${found.id}`;
    return found.id;
  }
  const id = newId();
  await m`insert into employees (id, entity_id, user_id, name, manager_id, office, joined_on, created_by)
          values (${id}, ${spec.entityId}, ${spec.userId}, ${spec.name}, ${spec.managerId},
                  ${spec.office}, ${spec.joinedOn}, ${by})`;
  return id;
}

async function ensureLeaveType(m: Sql, name: string, by: string): Promise<string> {
  const [found] = await m<{ id: string }[]>`
    select id from leave_types where entity_id = ${HR_JOURNEY.entityId} and name = ${name}`;
  if (found) return found.id;
  const id = newId();
  await m`insert into leave_types (id, entity_id, name, days_per_year, carries_forward, is_paid, created_by)
          values (${id}, ${HR_JOURNEY.entityId}, ${name}, ${HR_JOURNEY.startingDays}, false, true, ${by})`;
  return id;
}

/** The day after `iso`, as `YYYY-MM-DD`. */
function dayAfter(iso: string): string {
  const next = new Date(`${iso}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Makes the HR fixtures and answers, per project, the first leave day its journey may ask for. */
export async function ensureHrJourneys(ids: {
  executive: string;
  teleCaller: string;
  teamLead: string;
  snapshotLead: string;
  snapshotTracker: string;
}): Promise<{ leaveDays: Record<ProjectName, string> }> {
  return asMigrator((m) =>
    m.begin(async (tx) => {
      const by = ids.executive;
      const lead = await ensureEmployee(
        tx,
        {
          ...HR_JOURNEY.lead,
          entityId: HR_JOURNEY.entityId,
          userId: ids.teamLead,
          managerId: null,
        },
        by,
      );
      const asker = await ensureEmployee(
        tx,
        {
          ...HR_JOURNEY.asker,
          entityId: HR_JOURNEY.entityId,
          userId: ids.teleCaller,
          managerId: lead,
        },
        by,
      );

      const leaveDays = {} as Record<ProjectName, string>;
      for (const project of PROJECTS) {
        const typeId = await ensureLeaveType(tx, HR_JOURNEY.leaveTypes[project], by);
        const [held] = await tx<{ days: string }[]>`
          select coalesce(sum(days), 0)::text as days from leave_balances
           where employee_id = ${asker} and leave_type_id = ${typeId}`;
        const short = HR_JOURNEY.startingDays - Number(held?.days ?? '0');
        if (short > 0) {
          await tx`insert into leave_balances
                     (id, entity_id, employee_id, leave_type_id, kind, days, reason, created_by)
                   values (${newId()}, ${HR_JOURNEY.entityId}, ${asker}, ${typeId}, 'grant',
                           ${short}, ${HR_JOURNEY.grantReason}, ${by})`;
        }
        // Each project asks in a decade of its own, so the latest of its own type is the latest
        // of its decade.
        const [latest] = await tx<{ day: string | null }[]>`
          select max(to_date)::text as day from leave_requests
           where employee_id = ${asker} and leave_type_id = ${typeId}`;
        leaveDays[project] =
          latest?.day === null || latest?.day === undefined
            ? HR_JOURNEY.firstLeaveDays[project]
            : dayAfter(latest.day);
      }

      const snapshot = SNAPSHOT_COMPANY.entityId;
      const snapLead = await ensureEmployee(
        tx,
        {
          ...HR_JOURNEY.snapshot.lead,
          entityId: snapshot,
          userId: ids.snapshotLead,
          managerId: null,
        },
        by,
      );
      await ensureEmployee(
        tx,
        {
          ...HR_JOURNEY.snapshot.caller,
          entityId: snapshot,
          userId: ids.snapshotTracker,
          managerId: snapLead,
        },
        by,
      );
      await ensureEmployee(
        tx,
        { ...HR_JOURNEY.snapshot.helper, entityId: snapshot, userId: null, managerId: snapLead },
        by,
      );
      return { leaveDays };
    }),
  );
}
