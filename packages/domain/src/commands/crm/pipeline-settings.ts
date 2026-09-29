import {
  ArchiveStageInput,
  CreateStageInput,
  DomainError,
  newId,
  PipelineSettingsDto,
  RECORDED_STAGE_EXIT_FIELDS,
  ReorderStagesInput,
  StageExitFieldSchema,
  StageSettingsDto,
  StageSettingsListDto,
  UpdatePipelineInput,
  UpdateStageInput,
  type StageExitField,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { assertConfigScope } from './config-scope';

/**
 * Pipelines and their stages, as an Executive shapes them on the pipelines settings page
 * (docs/design/phase1.md §6.6, CRM-05, workshop CRM-1 and CRM-2). A stage is never deleted: an
 * archived stage keeps the leads that passed through it readable. Open stages come first in
 * position order, then Won and Lost, then archived stages; a lead enters at the first open stage.
 */

type PipelineRow = typeof schema.pipelines.$inferSelect;
type StageRow = typeof schema.pipelineStages.$inferSelect;

const ps = schema.pipelineStages;

/**
 * The pipeline, read under the caller's policies, its scope checked, then locked. The scope is
 * checked before the lock because a lock reads under the update policy, which would hide a
 * pipeline out of scope as if it did not exist.
 */
async function lockPipeline(ctx: CommandContext, pipelineId: string): Promise<PipelineRow> {
  const p = schema.pipelines;
  const [seen] = await ctx.tx
    .select({ entityId: p.entityId })
    .from(p)
    .where(eq(p.id, pipelineId))
    .limit(1);
  if (!seen) {
    throw new DomainError('not_found', `pipeline ${pipelineId} is not visible`, {
      reason: 'pipeline_missing',
    });
  }
  await assertConfigScope(ctx, seen.entityId);
  const [row] = await ctx.tx.select().from(p).where(eq(p.id, pipelineId)).limit(1).for('update');
  if (!row) throw new DomainError('forbidden', `pipeline ${pipelineId} is outside write scope`);
  return row;
}

/** Every stage of the pipeline, archived ones too, locked in position order. */
async function lockStages(ctx: CommandContext, pipelineId: string): Promise<StageRow[]> {
  return ctx.tx
    .select()
    .from(ps)
    .where(eq(ps.pipelineId, pipelineId))
    .orderBy(asc(ps.position))
    .for('update');
}

/** The stage and its pipeline, both locked; an archived stage is not found. */
async function lockStage(
  ctx: CommandContext,
  stageId: string,
): Promise<{ stage: StageRow; stages: StageRow[] }> {
  const [seen] = await ctx.tx
    .select({ pipelineId: ps.pipelineId })
    .from(ps)
    .where(eq(ps.id, stageId))
    .limit(1);
  if (!seen) throw stageMissing(stageId);
  await lockPipeline(ctx, seen.pipelineId);
  const stages = await lockStages(ctx, seen.pipelineId);
  const stage = stages.find((s) => s.id === stageId);
  if (stage?.archivedAt !== null) throw stageMissing(stageId);
  return { stage, stages };
}

function stageMissing(stageId: string): DomainError {
  return new DomainError('not_found', `stage ${stageId} is not available`, {
    reason: 'stage_missing',
  });
}

const ExitRules = z.object({ requiredFields: z.array(z.string()).optional() }).loose();

/** The fields a stage requires, as the catalogue names them; an unknown name is dropped. */
export function requiredFieldsOf(stage: Pick<StageRow, 'stageExitRulesJson'>): StageExitField[] {
  const parsed = ExitRules.safeParse(stage.stageExitRulesJson);
  const fields = parsed.success ? (parsed.data.requiredFields ?? []) : [];
  return fields.flatMap((f) => {
    const field = StageExitFieldSchema.safeParse(f);
    return field.success ? [field.data] : [];
  });
}

export function toStageDto(row: StageRow): StageSettingsDto {
  return StageSettingsDto.parse({
    id: row.id,
    pipelineId: row.pipelineId,
    key: row.key,
    name: row.name,
    position: row.position,
    kind: row.kind,
    requiredFields: requiredFieldsOf(row),
    archived: row.archivedAt !== null,
  });
}

function toPipelineDto(row: PipelineRow): PipelineSettingsDto {
  return PipelineSettingsDto.parse({
    id: row.id,
    entityId: row.entityId,
    key: row.key,
    name: row.name,
    segment: row.segment,
    lockHours: row.lockHours,
    firstContactSlaMinutes: row.firstContactSlaMinutes,
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Two live stages of one pipeline never share a name, whatever its case. */
function assertNameFree(stages: readonly StageRow[], name: string, except?: string): void {
  const taken = stages.some(
    (s) => s.archivedAt === null && s.id !== except && s.name.toLowerCase() === name.toLowerCase(),
  );
  if (taken) {
    throw new DomainError('validation_failed', 'another stage has this name', {
      reason: 'stage_name_taken',
    });
  }
}

/**
 * The order positions follow: live open stages, then live Won and Lost stages, then archived
 * stages, each group in its current order unless `open` gives the open stages' order.
 */
function standardOrder(stages: readonly StageRow[], open?: readonly string[]): string[] {
  const live = stages.filter((s) => s.archivedAt === null);
  return [
    ...(open ?? live.filter((s) => s.kind === 'open').map((s) => s.id)),
    ...live.filter((s) => s.kind !== 'open').map((s) => s.id),
    ...stages.filter((s) => s.archivedAt !== null).map((s) => s.id),
  ];
}

/**
 * Writes positions 1..n in `order` and audits each stage whose position changed. Positions are
 * unique per pipeline, so the stages that move first step aside to negative positions and then
 * take their new ones.
 */
async function renumber(
  ctx: CommandContext,
  stages: readonly StageRow[],
  order: readonly string[],
  /** A stage the caller audits itself, with its position (a new or an archived stage). */
  auditedByCaller?: string,
): Promise<void> {
  const before = new Map(stages.map((s) => [s.id, s.position]));
  const moves = order
    .map((id, i) => ({ id, from: before.get(id), to: i + 1 }))
    .filter((m) => m.from !== m.to);
  if (moves.length === 0) return;
  const ids = moves.map((m) => m.id);
  await ctx.tx.execute(
    sql`update pipeline_stages set position = -position - 1000
         where id = any(${`{${ids.join(',')}}`}::uuid[])`,
  );
  const values = sql.join(
    moves.map((m) => sql`(${m.id}::uuid, ${m.to}::int)`),
    sql`, `,
  );
  await ctx.tx.execute(
    sql`update pipeline_stages s set position = v.position, updated_by = ${ctx.principal.id}
          from (values ${values}) as v(id, position)
         where s.id = v.id`,
  );
  const stage = new Map(stages.map((s) => [s.id, s]));
  for (const m of moves) {
    if (m.id === auditedByCaller) continue;
    ctx.audit({
      aggregateType: 'pipeline_stage',
      aggregateId: m.id,
      entityId: stage.get(m.id)?.entityId ?? null,
      before: { position: m.from ?? null },
      after: { position: m.to },
    });
  }
}

async function reload(ctx: CommandContext, stageId: string): Promise<StageRow> {
  const [row] = await ctx.tx.select().from(ps).where(eq(ps.id, stageId)).limit(1);
  if (!row) throw new DomainError('internal', `stage ${stageId} vanished`);
  return row;
}

/** `crm.pipeline.update`: a pipeline's name, lock hours and first-contact time limit. */
export const updatePipeline = defineCommand({
  name: 'crm.pipeline.update',
  permission: 'crm.config.write',
  minScope: 'all',
  input: UpdatePipelineInput,
  output: PipelineSettingsDto,
  auditFields: ['name', 'lockHours', 'firstContactSlaMinutes'],
  async handler(ctx, input) {
    const row = await lockPipeline(ctx, input.pipelineId);
    const change: Partial<Pick<PipelineRow, 'name' | 'lockHours' | 'firstContactSlaMinutes'>> = {};
    if (input.name !== undefined && input.name !== row.name) change.name = input.name;
    if (input.lockHours !== undefined && input.lockHours !== row.lockHours) {
      change.lockHours = input.lockHours;
    }
    if (
      input.firstContactSlaMinutes !== undefined &&
      input.firstContactSlaMinutes !== row.firstContactSlaMinutes
    ) {
      change.firstContactSlaMinutes = input.firstContactSlaMinutes;
    }
    if (Object.keys(change).length === 0) return toPipelineDto(row);

    const p = schema.pipelines;
    const [updated] = await ctx.tx
      .update(p)
      .set({ ...change, updatedBy: ctx.principal.id })
      .where(eq(p.id, row.id))
      .returning();
    if (!updated) throw new DomainError('forbidden', `pipeline ${row.id} is outside write scope`);
    const before = Object.fromEntries(
      Object.keys(change).map((k) => [k, row[k as keyof typeof change]]),
    );
    ctx.audit({
      aggregateType: 'pipeline',
      aggregateId: row.id,
      entityId: row.entityId,
      before,
      after: change,
    });
    return toPipelineDto(updated);
  },
});

/** `crm.stage.create`: a stage added as the last open stage, before Won and Lost. */
export const createStage = defineCommand({
  name: 'crm.stage.create',
  permission: 'crm.config.write',
  minScope: 'all',
  input: CreateStageInput,
  output: StageSettingsDto,
  auditFields: ['name', 'position'],
  async handler(ctx, input) {
    const pipeline = await lockPipeline(ctx, input.pipelineId);
    const stages = await lockStages(ctx, pipeline.id);
    assertNameFree(stages, input.name);

    const id = newId();
    const last = stages.reduce((max, s) => Math.max(max, s.position), 0);
    const [created] = await ctx.tx
      .insert(ps)
      .values({
        id,
        pipelineId: pipeline.id,
        entityId: pipeline.entityId,
        key: `custom_${id.slice(-12)}`,
        name: input.name,
        position: last + 1,
        kind: 'open',
        stageExitRulesJson: {},
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!created) throw new DomainError('internal', 'stage insert returned no row');

    const openIds = stages
      .filter((s) => s.archivedAt === null && s.kind === 'open')
      .map((s) => s.id);
    const order = standardOrder([...stages, created], [...openIds, id]);
    // The new stage is audited once, as created at the position it ends at.
    await renumber(ctx, [...stages, created], order, id);
    const position = order.indexOf(id) + 1;
    ctx.audit({
      aggregateType: 'pipeline_stage',
      aggregateId: id,
      entityId: pipeline.entityId,
      before: null,
      after: { name: input.name, position },
    });
    return toStageDto(await reload(ctx, id));
  },
});

/**
 * `crm.stage.update`: a stage's name, and the details a lead must have before it leaves an open
 * stage. Only details a lead carries today may be required (`RECORDED_STAGE_EXIT_FIELDS`), so no
 * lead is held by one nobody can fill in.
 */
export const updateStage = defineCommand({
  name: 'crm.stage.update',
  permission: 'crm.config.write',
  minScope: 'all',
  input: UpdateStageInput,
  output: StageSettingsDto,
  auditFields: ['name', 'requiredFields'],
  async handler(ctx, input) {
    const { stage, stages } = await lockStage(ctx, input.stageId);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const set: Partial<Pick<StageRow, 'name' | 'stageExitRulesJson'>> = {};

    if (input.name !== undefined && input.name !== stage.name) {
      assertNameFree(stages, input.name, stage.id);
      set.name = input.name;
      before.name = stage.name;
      after.name = input.name;
    }
    if (input.requiredFields !== undefined) {
      if (stage.kind !== 'open') {
        throw new DomainError('validation_failed', 'a closing stage has no exit rules', {
          reason: 'stage_closing',
        });
      }
      const recorded: readonly string[] = RECORDED_STAGE_EXIT_FIELDS;
      if (input.requiredFields.some((f) => !recorded.includes(f))) {
        throw new DomainError('validation_failed', 'a lead does not carry this detail yet', {
          reason: 'stage_field_not_recorded',
        });
      }
      const current = requiredFieldsOf(stage);
      if (current.join(',') !== input.requiredFields.join(',')) {
        const rules = ExitRules.safeParse(stage.stageExitRulesJson);
        set.stageExitRulesJson = {
          ...(rules.success ? rules.data : {}),
          requiredFields: input.requiredFields,
        };
        before.requiredFields = current;
        after.requiredFields = input.requiredFields;
      }
    }
    if (Object.keys(set).length === 0) return toStageDto(stage);

    const [updated] = await ctx.tx
      .update(ps)
      .set({ ...set, updatedBy: ctx.principal.id })
      .where(eq(ps.id, stage.id))
      .returning();
    if (!updated) throw new DomainError('forbidden', `stage ${stage.id} is outside write scope`);
    ctx.audit({
      aggregateType: 'pipeline_stage',
      aggregateId: stage.id,
      entityId: stage.entityId,
      before,
      after,
    });
    return toStageDto(updated);
  },
});

/** `crm.stage.reorder`: the pipeline's open stages in a new order, every one of them once. */
export const reorderStages = defineCommand({
  name: 'crm.stage.reorder',
  permission: 'crm.config.write',
  minScope: 'all',
  input: ReorderStagesInput,
  output: StageSettingsListDto,
  auditFields: ['position'],
  async handler(ctx, input) {
    const pipeline = await lockPipeline(ctx, input.pipelineId);
    const stages = await lockStages(ctx, pipeline.id);
    const open = stages.filter((s) => s.archivedAt === null && s.kind === 'open').map((s) => s.id);
    const same =
      open.length === input.stageIds.length && input.stageIds.every((id) => open.includes(id));
    if (!same) {
      throw new DomainError('validation_failed', 'the order must name every open stage once', {
        reason: 'stage_order_mismatch',
      });
    }
    await renumber(ctx, stages, standardOrder(stages, input.stageIds));
    const rows = await ctx.tx
      .select()
      .from(ps)
      .where(and(eq(ps.pipelineId, pipeline.id)))
      .orderBy(asc(ps.position));
    return StageSettingsListDto.parse({
      pipelineId: pipeline.id,
      stages: rows.filter((r) => r.archivedAt === null).map(toStageDto),
    });
  },
});

/**
 * `crm.stage.archive`: an open stage leaves the board. Refused while it holds open or nurture
 * leads (answered for every lead by `app.stage_has_open_leads()`), and for the first open stage,
 * where new leads enter. Won and Lost stay, since winning and losing need them.
 */
export const archiveStage = defineCommand({
  name: 'crm.stage.archive',
  permission: 'crm.config.write',
  minScope: 'all',
  input: ArchiveStageInput,
  output: StageSettingsDto,
  auditFields: ['archivedAt', 'position'],
  async handler(ctx, input) {
    const { stage, stages } = await lockStage(ctx, input.stageId);
    if (stage.kind !== 'open') {
      throw new DomainError('validation_failed', 'Won and Lost stages stay', {
        reason: 'stage_closing',
      });
    }
    const firstOpen = stages.find((s) => s.archivedAt === null && s.kind === 'open');
    if (firstOpen?.id === stage.id) {
      throw new DomainError('validation_failed', 'new leads enter at the first open stage', {
        reason: 'stage_first_open',
      });
    }
    const held = (await ctx.tx.execute(
      sql`select app.stage_has_open_leads(${stage.id}::uuid) as held`,
    )) as unknown as { held: boolean }[];
    if (held[0]?.held !== false) {
      throw new DomainError('validation_failed', 'the stage still holds open leads', {
        reason: 'stage_has_open_leads',
      });
    }
    const [updated] = await ctx.tx
      .update(ps)
      .set({ archivedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(eq(ps.id, stage.id))
      .returning();
    if (!updated) throw new DomainError('forbidden', `stage ${stage.id} is outside write scope`);
    // Archived stages follow the live ones, so the live positions stay a plain sequence. The
    // archived stage is audited once, with its archiving and its place at the end.
    const rows = stages.map((s) => (s.id === stage.id ? updated : s));
    const order = standardOrder(rows);
    await renumber(ctx, rows, order, stage.id);
    ctx.audit({
      aggregateType: 'pipeline_stage',
      aggregateId: stage.id,
      entityId: stage.entityId,
      before: { archivedAt: null, position: stage.position },
      after: { archivedAt: ctx.now.toISOString(), position: order.indexOf(stage.id) + 1 },
    });
    return toStageDto(await reload(ctx, stage.id));
  },
});
