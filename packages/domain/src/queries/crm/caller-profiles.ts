import {
  CallerPresenceSchema,
  CallerProfilePersonDto,
  CustomerLanguageSchema,
  SegmentSchema,
  type CallerPresence,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';

type Ctx = Pick<RequestContext, 'tx' | 'principal'>;

interface PersonRow {
  user_id: string;
  name: string;
  team_id: string | null;
  role_key: string;
  is_converter: boolean;
  presence: string;
  max_open: number | null;
  languages: string[];
  segments: string[];
}

/**
 * The people a manager sets up in one company, for the Lead converters page: those who work on
 * leads there (`app.caller_profile_people()`, under the caller's `crm.lead.assign` scope: the whole
 * company, or their own team), each with their profile (not a converter and away when they have
 * none), by name.
 */
export async function listCallerProfiles(
  ctx: Ctx,
  input: { entityId: number },
): Promise<CallerProfilePersonDto[]> {
  const rows = (await ctx.tx.execute(
    sql`select user_id, name, team_id, role_key, is_converter, presence, max_open, languages, segments
          from app.caller_profile_people(${input.entityId}::smallint)
         order by lower(name), user_id`,
  )) as unknown as PersonRow[];
  return rows.map((r) =>
    CallerProfilePersonDto.parse({
      userId: r.user_id,
      name: r.name,
      teamId: r.team_id,
      roleKey: r.role_key,
      isConverter: r.is_converter,
      presence: r.presence,
      maxOpen: r.max_open,
      languages: r.languages.map((l) => CustomerLanguageSchema.parse(l)),
      segments: r.segments.map((s) => SegmentSchema.parse(s)),
    }),
  );
}

/** The caller's own presence in one company; away when they never set it. */
export async function loadOwnPresence(
  ctx: Ctx,
  input: { entityId: number },
): Promise<CallerPresence> {
  const cp = schema.callerProfiles;
  const [row] = await ctx.tx
    .select({ presence: cp.presence })
    .from(cp)
    .where(and(eq(cp.userId, ctx.principal.id), eq(cp.entityId, input.entityId)))
    .limit(1);
  return CallerPresenceSchema.parse(row?.presence ?? 'away');
}
