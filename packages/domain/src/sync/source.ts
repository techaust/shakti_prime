import { sql, type SQL } from 'drizzle-orm';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

/**
 * Pieces the collections' sources share (`collections.ts`). A source is the SQL of one
 * collection's rows in the person's working set, read under their own row security in the pull's
 * transaction, with three columns every source names:
 * - `id`, the record's id;
 * - `since`, from when the row has surely been in the working set (it was made then, or the
 *   project it hangs from was);
 * - `changed_at`, its last change that the phone must see, never before `since`.
 */

/** A timestamp as the records carry it: ISO 8601 in UTC with milliseconds, or null. */
export const isoText = (expr: SQL): SQL =>
  sql`pg_catalog.to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * The projects in the person's working set: those they run or are on (their own, whatever their
 * role reads besides), live, or finished within `finishedProjectDays`. Row security decides the
 * rest: a project of a company outside the request, or one the person may not read, is never seen.
 */
export const memberProjects = (): SQL => sql`
  select p.* from public.projects p
   where (p.owner_id = app.user_id()
          or exists (select 1 from public.project_assignments a
                      where a.project_id = p.id and a.person_id = app.user_id()))
     and (p.state in ('active', 'on_hold')
          or p.state_changed_at >= pg_catalog.now()
               - ${WORKSHOP_DEFAULTS.field.finishedProjectDays} * interval '1 day')`;
