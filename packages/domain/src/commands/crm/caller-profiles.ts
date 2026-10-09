import {
  CallerProfileDto,
  CustomerLanguageSchema,
  DomainError,
  newId,
  SegmentSchema,
  SetCallerProfileInput,
  SetPresenceInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from './opportunity-shared';

type ProfileRow = typeof schema.callerProfiles.$inferSelect;

function toDto(row: ProfileRow): CallerProfileDto {
  return CallerProfileDto.parse({
    userId: row.userId,
    entityId: row.entityId,
    isConverter: row.isConverter,
    presence: row.presence,
    maxOpen: row.maxOpen,
    languages: row.languages.map((l) => CustomerLanguageSchema.parse(l)),
    segments: row.segments.map((s) => SegmentSchema.parse(s)),
  });
}

function profileFields(row: ProfileRow | undefined) {
  return row === undefined
    ? null
    : {
        isConverter: row.isConverter,
        presence: row.presence,
        maxOpen: row.maxOpen,
        languages: row.languages.join(', '),
        segments: row.segments.join(', '),
      };
}

async function ownProfile(ctx: Pick<CommandContext, 'tx'>, userId: string, entityId: number) {
  const cp = schema.callerProfiles;
  const [row] = await ctx.tx
    .select()
    .from(cp)
    .where(and(eq(cp.userId, userId), eq(cp.entityId, entityId)))
    .limit(1);
  return row;
}

/**
 * `crm.caller_profile.set` (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2): a person's part in the
 * handover in one company: whether they are a Lead Converter, the most open leads they take, and
 * the languages and business lines they take (a blank list takes all). For whoever holds
 * `crm.lead.assign`: a Sales Team Lead for their team, a General Manager for the company, an
 * Executive for any. The person must work on leads in the company (`app.caller_profile_people()`
 * lists them under the caller's scope). Their presence is theirs alone and is not changed here.
 */
export const setCallerProfile = defineCommand({
  name: 'crm.caller_profile.set',
  permission: 'crm.lead.assign',
  minScope: 'team',
  peopleOnly: true,
  input: SetCallerProfileInput,
  output: CallerProfileDto,
  auditFields: ['isConverter', 'presence', 'maxOpen', 'languages', 'segments'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const people = (await ctx.tx.execute(
      sql`select user_id from app.caller_profile_people(${input.entityId}::smallint)
           where user_id = ${input.userId}::uuid`,
    )) as unknown as { user_id: string }[];
    if (people.length === 0) {
      throw new DomainError('not_found', `${input.userId} is not a person you set up here`, {
        reason: 'profile_person_missing',
      });
    }
    const before = await ownProfile(ctx, input.userId, input.entityId);
    const cp = schema.callerProfiles;
    const settings = {
      isConverter: input.isConverter,
      maxOpen: input.maxOpen,
      languages: [...new Set(input.languages)].sort(),
      segments: [...new Set(input.segments)].sort(),
    };
    const [row] = await ctx.tx
      .insert(cp)
      .values({
        id: newId(),
        userId: input.userId,
        entityId: input.entityId,
        ...settings,
        updatedBy: ctx.principal.id,
      })
      .onConflictDoUpdate({
        target: [cp.userId, cp.entityId],
        set: { ...settings, updatedBy: ctx.principal.id },
      })
      .returning();
    if (!row) throw new DomainError('internal', 'caller profile upsert returned no row');
    ctx.audit({
      aggregateType: 'caller_profile',
      aggregateId: row.id,
      entityId: input.entityId,
      before: profileFields(before),
      after: profileFields(row),
    });
    return toDto(row);
  },
});

/**
 * `crm.caller_profile.set_presence`: the caller's own presence in one company, present to take
 * qualified leads from the handover, away not to. Only the caller's own row, never another
 * person's (the row policy and the guard trigger); a person with no profile yet gets one that
 * is not a Lead Converter until a manager says so.
 */
export const setPresence = defineCommand({
  name: 'crm.caller_profile.set_presence',
  permission: 'profile.write',
  minScope: 'own',
  peopleOnly: true,
  input: SetPresenceInput,
  output: CallerProfileDto,
  auditFields: ['presence'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const before = await ownProfile(ctx, ctx.principal.id, input.entityId);
    const cp = schema.callerProfiles;
    const [row] = await ctx.tx
      .insert(cp)
      .values({
        id: newId(),
        userId: ctx.principal.id,
        entityId: input.entityId,
        presence: input.presence,
        updatedBy: ctx.principal.id,
      })
      .onConflictDoUpdate({
        target: [cp.userId, cp.entityId],
        set: { presence: input.presence, updatedBy: ctx.principal.id },
      })
      .returning();
    if (!row) throw new DomainError('internal', 'caller profile upsert returned no row');
    if (before?.presence !== row.presence) {
      ctx.audit({
        aggregateType: 'caller_profile',
        aggregateId: row.id,
        entityId: input.entityId,
        before: before === undefined ? null : { presence: before.presence },
        after: { presence: row.presence },
      });
    }
    return toDto(row);
  },
});
