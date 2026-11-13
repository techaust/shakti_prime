import {
  DomainError,
  DraftPlaybookDirectiveInput,
  EditPlaybookDirectiveInput,
  newId,
  PlaybookConflictCheckDto,
  PlaybookDirectiveDto,
  PlaybookDirectiveRefInput,
  ResolvePlaybookConflictInput,
  RetirePlaybookDirectiveInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import {
  assertPlaybookGroupRequest,
  checkIsFresh,
  directiveState,
  firePlaybookDirective,
  lockPlaybookDirective,
  openConflicts,
  playbookChangedPayload,
  playbookConflictCheckDto,
  playbookDirectiveDto,
  requireAudience,
  type PlaybookDirectiveRow,
} from './playbook-shared';

/*
 * The Business Playbook's commands (docs/03-roadmap-appendix/phase2.md §5.4, PRD AI-01). An
 * Executive or a General Manager (`knowledge.playbook.draft`, every company) drafts, edits and
 * retires drafts; only an Executive (`knowledge.playbook.approve`) approves one, retires an
 * approved one and resolves a conflict. No agent runs any of them. Each change is audited and
 * emits `knowledge.playbook.changed`, which runs the conflict check on new wording and bumps the
 * Playbook's version so the agents read the approved set again.
 */

/** The directive's facts the audit row records besides its id. */
function described(row: PlaybookDirectiveRow) {
  return {
    directiveType: row.type,
    audience: row.audience,
    title: row.title,
    directiveState: row.state,
  };
}

/**
 * `knowledge.playbook.draft`: a new draft for the request's company or, with `wholeGroup` in a
 * request for every company, for the whole group, for an audience the drafter reads. Its source,
 * when named, is a vault file the drafter reads. The conflict check runs on it next.
 */
export const draftPlaybookDirective = defineCommand({
  name: 'knowledge.playbook.draft',
  permission: 'knowledge.playbook.draft',
  minScope: 'all',
  peopleOnly: true,
  input: DraftPlaybookDirectiveInput,
  output: PlaybookDirectiveDto,
  auditFields: ['directiveType', 'audience', 'title', 'directiveState', 'wholeGroup', 'fromVaultFile'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    if (input.wholeGroup) await assertPlaybookGroupRequest(ctx);
    requireAudience(ctx.principal, input.audience);
    if (input.sourceFileId !== null) {
      const k = schema.knowledgeFiles;
      const [file] = await ctx.tx
        .select({ state: k.state })
        .from(k)
        .where(eq(k.id, input.sourceFileId))
        .limit(1);
      if (file === undefined || file.state === 'archived') {
        throw new DomainError('not_found', `vault file ${input.sourceFileId} is not visible`, {
          reason: 'playbook_source_missing',
        });
      }
    }
    const state = firePlaybookDirective(ctx, { state: null, checked: false, conflictsWith: [] }, 'create');
    const [row] = await ctx.tx
      .insert(schema.playbookDirectives)
      .values({
        id: newId(),
        entityId: input.wholeGroup ? null : input.entityId,
        type: input.type,
        audience: input.audience,
        title: input.title,
        text: input.text,
        sourceFileId: input.sourceFileId,
        sourcePosition: input.sourcePosition,
        state,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'directive insert returned no row');
    ctx.emit({
      type: 'knowledge.playbook.changed',
      entityId: input.entityId,
      aggregateType: 'playbook_directive',
      aggregateId: row.id,
      payload: playbookChangedPayload(row, 'drafted'),
    });
    ctx.audit({
      aggregateType: 'playbook_directive',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: {
        ...described(row),
        wholeGroup: input.wholeGroup,
        fromVaultFile: row.sourceFileId !== null,
      },
    });
    return playbookDirectiveDto(row);
  },
});

/**
 * `knowledge.playbook.edit`: a draft's new wording, type and audience. Its conflict check is
 * cleared and runs again on the new wording.
 */
export const editPlaybookDirective = defineCommand({
  name: 'knowledge.playbook.edit',
  permission: 'knowledge.playbook.draft',
  minScope: 'all',
  peopleOnly: true,
  input: EditPlaybookDirectiveInput,
  output: PlaybookDirectiveDto,
  auditFields: ['directiveType', 'audience', 'title', 'directiveState', 'textChanged'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockPlaybookDirective(ctx, input.directiveId);
    firePlaybookDirective(
      ctx,
      { state: directiveState(row), checked: row.checkedAt !== null, conflictsWith: row.conflictsWith },
      'edit',
    );
    requireAudience(ctx.principal, input.audience);
    const d = schema.playbookDirectives;
    // The guard trigger clears the check whenever the wording, type or audience changes.
    const [updated] = await ctx.tx
      .update(d)
      .set({
        type: input.type,
        audience: input.audience,
        title: input.title,
        text: input.text,
        updatedBy: ctx.principal.id,
      })
      .where(eq(d.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal', `directive ${row.id} update returned no row`);
    ctx.emit({
      type: 'knowledge.playbook.changed',
      entityId: input.entityId,
      aggregateType: 'playbook_directive',
      aggregateId: updated.id,
      payload: playbookChangedPayload(updated, 'edited'),
    });
    ctx.audit({
      aggregateType: 'playbook_directive',
      aggregateId: row.id,
      entityId: row.entityId,
      before: described(row),
      after: { ...described(updated), textChanged: updated.text !== row.text },
    });
    return playbookDirectiveDto(updated);
  },
});

/**
 * `knowledge.playbook.approve`: a draft becomes part of the Playbook the agents read. Refused
 * while its conflict check has not run on the current wording, or has not run since a directive
 * of the same type for an overlapping company was approved (`playbook_check_pending`), and while
 * any conflict or overlap it found is unresolved (`playbook_conflict_open`).
 */
export const approvePlaybookDirective = defineCommand({
  name: 'knowledge.playbook.approve',
  permission: 'knowledge.playbook.approve',
  minScope: 'all',
  peopleOnly: true,
  input: PlaybookDirectiveRefInput,
  output: PlaybookDirectiveDto,
  auditFields: ['directiveState'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockPlaybookDirective(ctx, input.directiveId);
    const state = directiveState(row);
    // A move the machine lacks is refused before the facts are read.
    const checked = state === 'draft' ? await checkIsFresh(ctx, row) : false;
    const conflictsWith = state === 'draft' ? await openConflicts(ctx, row) : row.conflictsWith;
    const to = firePlaybookDirective(ctx, { state, checked, conflictsWith }, 'approve');
    const d = schema.playbookDirectives;
    const [updated] = await ctx.tx
      .update(d)
      .set({
        state: to,
        approvedBy: ctx.principal.id,
        approvedAt: ctx.now,
        conflictsWith: [],
        updatedBy: ctx.principal.id,
      })
      .where(eq(d.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal', `directive ${row.id} update returned no row`);
    ctx.emit({
      type: 'knowledge.playbook.changed',
      entityId: input.entityId,
      aggregateType: 'playbook_directive',
      aggregateId: updated.id,
      payload: playbookChangedPayload(updated, 'approved'),
    });
    ctx.audit({
      aggregateType: 'playbook_directive',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { directiveState: row.state },
      after: { directiveState: updated.state },
    });
    return playbookDirectiveDto(updated);
  },
});

/**
 * `knowledge.playbook.retire`: a draft that will not be approved (`knowledge.playbook.draft`), or
 * an approved directive that no longer holds (`knowledge.playbook.approve`, which the machine
 * checks for that move), with the reason. Open conflicts naming a retired approved directive are
 * resolved as `other_retired` and leave the drafts' `conflicts_with`.
 */
export const retirePlaybookDirective = defineCommand({
  name: 'knowledge.playbook.retire',
  permission: 'knowledge.playbook.draft',
  minScope: 'all',
  peopleOnly: true,
  input: RetirePlaybookDirectiveInput,
  output: PlaybookDirectiveDto,
  auditFields: ['directiveState', 'retiredReason', 'conflictsSettled'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockPlaybookDirective(ctx, input.directiveId);
    const to = firePlaybookDirective(
      ctx,
      { state: directiveState(row), checked: row.checkedAt !== null, conflictsWith: row.conflictsWith },
      'retire',
      { reason: input.reason },
    );
    const d = schema.playbookDirectives;
    const [updated] = await ctx.tx
      .update(d)
      .set({
        state: to,
        retiredReason: input.reason,
        retiredAt: ctx.now,
        updatedBy: ctx.principal.id,
      })
      .where(eq(d.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal', `directive ${row.id} update returned no row`);
    let conflictsSettled = 0;
    if (row.state === 'approved') {
      const c = schema.playbookConflictChecks;
      const settled = await ctx.tx
        .update(c)
        .set({ resolution: 'other_retired', resolvedBy: ctx.principal.id, resolvedAt: ctx.now })
        .where(
          and(eq(c.otherId, row.id), inArray(c.label, ['conflict', 'overlap']), isNull(c.resolvedAt)),
        )
        .returning({ id: c.id });
      conflictsSettled = settled.length;
      await ctx.tx
        .update(d)
        .set({ conflictsWith: sql`array_remove(${d.conflictsWith}, ${row.id}::uuid)` })
        .where(and(eq(d.state, 'draft'), sql`${row.id}::uuid = any(${d.conflictsWith})`));
    }
    ctx.emit({
      type: 'knowledge.playbook.changed',
      entityId: input.entityId,
      aggregateType: 'playbook_directive',
      aggregateId: updated.id,
      payload: playbookChangedPayload(updated, 'retired'),
    });
    ctx.audit({
      aggregateType: 'playbook_directive',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { directiveState: row.state },
      after: { directiveState: updated.state, retiredReason: input.reason, conflictsSettled },
    });
    return playbookDirectiveDto(updated);
  },
});

/**
 * `knowledge.playbook.resolve_conflict`: an open conflict or overlap on a draft is not a conflict
 * (the note says why), or is settled by retiring the other directive (the note is its reason).
 * The draft's `conflicts_with` drops the other directive either way.
 */
export const resolvePlaybookConflict = defineCommand({
  name: 'knowledge.playbook.resolve_conflict',
  permission: 'knowledge.playbook.approve',
  minScope: 'all',
  peopleOnly: true,
  input: ResolvePlaybookConflictInput,
  output: PlaybookConflictCheckDto,
  auditFields: ['resolution', 'resolutionNote'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const c = schema.playbookConflictChecks;
    const [seen] = await ctx.tx
      .select({ directiveId: c.directiveId })
      .from(c)
      .where(eq(c.id, input.checkId))
      .limit(1);
    if (seen === undefined) {
      throw new DomainError('not_found', `conflict ${input.checkId} is not visible`, {
        reason: 'playbook_conflict_missing',
      });
    }
    // The draft first, then the pair, in the order the conflict check takes them.
    const directive = await lockPlaybookDirective(ctx, seen.directiveId);
    const [check] = await ctx.tx
      .select()
      .from(c)
      .where(eq(c.id, input.checkId))
      .limit(1)
      .for('update');
    if (check === undefined || (check.label !== 'conflict' && check.label !== 'overlap')) {
      throw new DomainError('not_found', `conflict ${input.checkId} is not open`, {
        reason: 'playbook_conflict_missing',
      });
    }
    if (check.resolvedAt !== null) {
      throw new DomainError('conflict', `conflict ${input.checkId} is already resolved`, {
        reason: 'playbook_conflict_resolved',
      });
    }
    if (directive.state !== 'draft') {
      throw new DomainError('conflict', 'only a draft has conflicts to resolve', {
        reason: 'playbook_directive_transition_not_allowed',
      });
    }
    await ctx.tx
      .update(c)
      .set({
        resolution: input.resolution,
        resolutionNote: input.note,
        resolvedBy: ctx.principal.id,
        resolvedAt: ctx.now,
      })
      .where(eq(c.id, check.id));
    const d = schema.playbookDirectives;
    await ctx.tx
      .update(d)
      .set({
        conflictsWith: sql`array_remove(${d.conflictsWith}, ${check.otherId}::uuid)`,
        updatedBy: ctx.principal.id,
      })
      .where(eq(d.id, directive.id));
    if (input.resolution === 'other_retired') {
      // The other directive is retired with the note as its reason, which also settles every
      // other open pair naming it.
      await ctx.run(retirePlaybookDirective, {
        entityId: input.entityId,
        directiveId: check.otherId,
        reason: input.note,
      });
    }
    const [resolved] = await ctx.tx.select().from(c).where(eq(c.id, check.id)).limit(1);
    if (resolved === undefined || resolved.resolvedAt === null) {
      throw new DomainError('internal', `conflict ${check.id} was not resolved`);
    }
    ctx.emit({
      type: 'knowledge.playbook.changed',
      entityId: input.entityId,
      aggregateType: 'playbook_directive',
      aggregateId: directive.id,
      payload: playbookChangedPayload(directive, 'conflict_resolved'),
    });
    ctx.audit({
      aggregateType: 'playbook_conflict_check',
      aggregateId: check.id,
      entityId: check.entityId,
      before: { resolution: null, resolutionNote: null },
      after: { resolution: resolved.resolution, resolutionNote: resolved.resolutionNote },
    });
    return playbookConflictCheckDto(resolved);
  },
});
