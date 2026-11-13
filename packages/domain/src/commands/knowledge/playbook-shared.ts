import {
  DomainError,
  hasGrant,
  PLAYBOOK_AUDIENCE_READ_PERMISSION,
  PlaybookConflictCheckDto,
  PlaybookDirectiveDto,
  PlaybookDirectiveStateSchema,
  type PlaybookAudience,
  type Principal,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { transition } from '../../state-machines/define-machine';
import {
  playbookDirectiveMachine,
  type PlaybookDirectiveEvent,
  type PlaybookDirectiveParams,
  type PlaybookDirectiveState,
} from '../../state-machines/machines/playbook-directive';

export type PlaybookDirectiveRow = typeof schema.playbookDirectives.$inferSelect;
export type PlaybookConflictCheckRow = typeof schema.playbookConflictChecks.$inferSelect;

/** The directive as the Playbook screen and the commands answer it; never its embedding. */
export function playbookDirectiveDto(row: PlaybookDirectiveRow): PlaybookDirectiveDto {
  return PlaybookDirectiveDto.parse({
    id: row.id,
    entityId: row.entityId,
    type: row.type,
    audience: row.audience,
    title: row.title,
    text: row.text,
    sourceFileId: row.sourceFileId,
    sourcePosition: row.sourcePosition,
    state: row.state,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    retiredReason: row.retiredReason,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    conflictsWith: row.conflictsWith,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function playbookConflictCheckDto(row: PlaybookConflictCheckRow): PlaybookConflictCheckDto {
  return PlaybookConflictCheckDto.parse({
    id: row.id,
    directiveId: row.directiveId,
    otherId: row.otherId,
    distance: row.distance,
    label: row.label,
    reason: row.reason,
    resolution: row.resolution,
    resolutionNote: row.resolutionNote,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  });
}

/** Whether the principal reads directives of this audience (SECURITY §3.2). */
export function readsAudience(principal: Principal, audience: PlaybookAudience): boolean {
  return hasGrant(principal.permissions, PLAYBOOK_AUDIENCE_READ_PERMISSION[audience], 'all');
}

/** A directive is written only for an audience its writer reads (the write policies agree). */
export function requireAudience(principal: Principal, audience: PlaybookAudience): void {
  if (!readsAudience(principal, audience)) {
    throw new DomainError('forbidden', 'a directive is written only for an audience its writer reads', {
      reason: 'playbook_audience_not_held',
    });
  }
}

/**
 * A directive of the whole group is changed only in a request for every active company, as a
 * vault file of the group is (ADR 0016); the write policies say the same.
 */
export async function assertPlaybookGroupRequest(ctx: CommandContext): Promise<void> {
  const covered = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  if (covered[0]?.ok !== true) {
    throw new DomainError('forbidden', 'a directive of the whole group needs every company', {
      reason: 'playbook_needs_all_companies',
    });
  }
}

/**
 * The directive, locked for this transaction, when the caller reads it (by its company, audience
 * and state); otherwise not found. A directive of the whole group needs a request for every company.
 */
export async function lockPlaybookDirective(
  ctx: CommandContext,
  directiveId: string,
): Promise<PlaybookDirectiveRow> {
  const d = schema.playbookDirectives;
  const [visible] = await ctx.tx
    .select({ entityId: d.entityId })
    .from(d)
    .where(eq(d.id, directiveId))
    .limit(1);
  if (visible?.entityId === null) await assertPlaybookGroupRequest(ctx);
  const [row] = await ctx.tx.select().from(d).where(eq(d.id, directiveId)).limit(1).for('update');
  if (!row) {
    throw new DomainError('not_found', `directive ${directiveId} is not visible`, {
      reason: 'playbook_directive_missing',
    });
  }
  return row;
}

export function directiveState(row: PlaybookDirectiveRow): PlaybookDirectiveState {
  return PlaybookDirectiveStateSchema.parse(row.state);
}

/** Fires an event of the directive's machine as the caller. */
export function firePlaybookDirective(
  ctx: CommandContext,
  record: { state: PlaybookDirectiveState | null; checked: boolean; conflictsWith: readonly string[] },
  event: PlaybookDirectiveEvent,
  params: PlaybookDirectiveParams = {},
): PlaybookDirectiveState {
  return transition(playbookDirectiveMachine, record, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params,
  }).to;
}

/**
 * Whether the conflict check on `row` still holds: it ran on the current wording, and no
 * directive of the same type whose companies overlap was approved after it ran (that directive
 * was never compared with this one, so the check runs again first).
 */
export async function checkIsFresh(
  ctx: CommandContext,
  row: PlaybookDirectiveRow,
): Promise<boolean> {
  if (row.checkedAt === null) return false;
  const d = schema.playbookDirectives;
  const companies =
    row.entityId === null ? undefined : or(isNull(d.entityId), eq(d.entityId, row.entityId));
  const [later] = await ctx.tx
    .select({ id: d.id })
    .from(d)
    .where(
      and(
        eq(d.state, 'approved'),
        eq(d.type, row.type),
        gt(d.approvedAt, row.checkedAt),
        companies,
      ),
    )
    .limit(1);
  return later === undefined;
}

/**
 * The approved directives still in conflict or overlap with `row`: every unresolved conflict or
 * overlap its check found, and every id `conflicts_with` names, except those the caller sees
 * retired. A pair the caller cannot see is counted as open, so a narrower view never approves
 * past a conflict.
 */
export async function openConflicts(
  ctx: CommandContext,
  row: PlaybookDirectiveRow,
): Promise<string[]> {
  const c = schema.playbookConflictChecks;
  const d = schema.playbookDirectives;
  const checks = await ctx.tx
    .select({ otherId: c.otherId })
    .from(c)
    .where(
      and(
        eq(c.directiveId, row.id),
        inArray(c.label, ['conflict', 'overlap']),
        isNull(c.resolvedAt),
      ),
    );
  const ids = [...new Set([...row.conflictsWith, ...checks.map((r) => r.otherId)])];
  if (ids.length === 0) return [];
  const retired = await ctx.tx
    .select({ id: d.id })
    .from(d)
    .where(and(inArray(d.id, ids), eq(d.state, 'retired')));
  const gone = new Set(retired.map((r) => r.id));
  return ids.filter((id) => !gone.has(id));
}

/** The payload of `knowledge.playbook.changed`; `recheck` when the wording is new. */
export function playbookChangedPayload(
  row: PlaybookDirectiveRow,
  change: 'drafted' | 'edited' | 'approved' | 'retired' | 'conflict_resolved',
): Record<string, unknown> {
  return {
    directiveEntityId: row.entityId,
    change,
    state: row.state,
    recheck: change === 'drafted' || change === 'edited',
  };
}
