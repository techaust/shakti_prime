import {
  DispositionDto,
  DispositionListDto,
  DispositionNextActionSchema,
  DomainError,
  newId,
  SetDispositionsInput,
  type Segment,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { assertConfigScope } from './config-scope';

type DispositionRow = typeof schema.callDispositions.$inferSelect;
const cd = schema.callDispositions;

/** The rows of one scope: the group or one company, every segment or one. */
export function dispositionScope(entityId: number | null, segment: Segment | null): SQL {
  const company = entityId === null ? isNull(cd.entityId) : eq(cd.entityId, entityId);
  const kind = segment === null ? isNull(cd.segment) : eq(cd.segment, segment);
  return sql`${company} and ${kind}`;
}

/** A code made from a label: lower case, words joined by underscores, starting with a letter. */
export function codeFromLabel(label: string): string {
  const words = label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
  const code = /^[a-z]/.test(words) ? words : `outcome_${words}`;
  return code.slice(0, 40).replace(/_+$/, '').padEnd(2, '_');
}

function toDto(row: DispositionRow): DispositionDto {
  return DispositionDto.parse({
    id: row.id,
    entityId: row.entityId,
    segment: row.segment,
    key: row.key,
    code: row.code,
    label: row.label,
    nextAction: DispositionNextActionSchema.parse(row.nextAction),
  });
}

async function liveRows(
  ctx: CommandContext,
  entityId: number | null,
  segment: Segment | null,
): Promise<DispositionRow[]> {
  return ctx.tx
    .select()
    .from(cd)
    .where(and(dispositionScope(entityId, segment), isNull(cd.archivedAt)))
    .orderBy(asc(cd.position))
    .for('update');
}

/**
 * `crm.disposition.set` (CALL-1, TEL-01): replaces a scope's call outcomes as a set. An outcome
 * that stays exactly as it was keeps its row; any other is archived, never deleted, so the calls
 * that recorded it keep their meaning, and the new ones are added. An empty list clears a company
 * or segment list, so the wider list applies again; the group's own list for every segment is
 * never emptied, so callers always have outcomes to choose from.
 */
export const setDispositions = defineCommand({
  name: 'crm.disposition.set',
  permission: 'crm.config.write',
  minScope: 'all',
  input: SetDispositionsInput,
  output: DispositionListDto,
  auditFields: ['key', 'label', 'nextAction', 'segment', 'position', 'archivedAt'],
  constraintReasons: {
    call_dispositions_scope_key_unique: 'disposition_key_taken',
    call_dispositions_scope_code_unique: 'disposition_code_taken',
  },
  async handler(ctx, input) {
    await assertConfigScope(ctx, input.entityId);
    if (input.entityId === null && input.segment === null && input.dispositions.length === 0) {
      throw new DomainError('validation_failed', 'the group list cannot be empty', {
        reason: 'dispositions_group_empty',
      });
    }
    const current = await liveRows(ctx, input.entityId, input.segment);

    // A new outcome keeps the code of the one it replaces under the same label.
    const byLabel = new Map(current.map((r) => [r.label.toLowerCase(), r.code]));
    const wanted = input.dispositions.map((d, i) => ({
      ...d,
      code: d.code ?? byLabel.get(d.label.toLowerCase()) ?? codeFromLabel(d.label),
      position: i + 1,
    }));
    if (new Set(wanted.map((d) => d.code)).size !== wanted.length) {
      throw new DomainError('validation_failed', 'two outcomes share a code', {
        reason: 'disposition_code_taken',
      });
    }

    const same = (r: DispositionRow, d: (typeof wanted)[number]) =>
      r.key === d.key && r.code === d.code && r.label === d.label && r.nextAction === d.nextAction;
    const kept = new Map<string, (typeof wanted)[number]>();
    for (const d of wanted) {
      const row = current.find((r) => same(r, d) && !kept.has(r.id));
      if (row) kept.set(row.id, d);
    }
    const retired = current.filter((r) => !kept.has(r.id));
    const added = wanted.filter((d) => ![...kept.values()].includes(d));

    const actor = ctx.principal.id;
    if (retired.length > 0) {
      await ctx.tx
        .update(cd)
        .set({ archivedAt: ctx.now, updatedBy: actor })
        .where(
          inArray(
            cd.id,
            retired.map((r) => r.id),
          ),
        );
      for (const r of retired) {
        ctx.audit({
          aggregateType: 'call_disposition',
          aggregateId: r.id,
          entityId: r.entityId,
          before: { key: r.key, label: r.label, nextAction: r.nextAction, archivedAt: null },
          after: { archivedAt: ctx.now.toISOString() },
        });
      }
    }
    for (const [id, d] of kept) {
      const row = current.find((r) => r.id === id);
      if (!row || row.position === d.position) continue;
      await ctx.tx.update(cd).set({ position: d.position, updatedBy: actor }).where(eq(cd.id, id));
      ctx.audit({
        aggregateType: 'call_disposition',
        aggregateId: id,
        entityId: row.entityId,
        before: { position: row.position },
        after: { position: d.position },
      });
    }
    if (added.length > 0) {
      const rows = added.map((d) => ({
        id: newId(),
        entityId: input.entityId,
        segment: input.segment,
        key: d.key,
        code: d.code,
        label: d.label,
        nextAction: d.nextAction,
        position: d.position,
        createdBy: actor,
      }));
      await ctx.tx.insert(cd).values(rows);
      for (const r of rows) {
        ctx.audit({
          aggregateType: 'call_disposition',
          aggregateId: r.id,
          entityId: r.entityId,
          before: null,
          after: {
            key: r.key,
            label: r.label,
            nextAction: r.nextAction,
            segment: r.segment,
            position: r.position,
          },
        });
      }
    }

    const after = await ctx.tx
      .select()
      .from(cd)
      .where(and(dispositionScope(input.entityId, input.segment), isNull(cd.archivedAt)))
      .orderBy(asc(cd.position));
    return DispositionListDto.parse({
      entityId: input.entityId,
      segment: input.segment,
      dispositions: after.map(toDto),
    });
  },
});
