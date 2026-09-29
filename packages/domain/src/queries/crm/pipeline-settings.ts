import {
  DispositionDto,
  DispositionListDto,
  DispositionNextActionSchema,
  PipelineSettingsViewDto,
  ScoreFactorSchema,
  ScoreRuleDto,
  type ConfigScopeInput,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { toStageDto } from '../../commands/crm/pipeline-settings';

type ReadContext = Pick<RequestContext, 'tx'>;

/**
 * The pipelines settings page (docs/design/phase1.md §6.6): every pipeline the request's
 * companies use, with its live stages in order. Read under RLS like the lead form's list; the
 * page offers changes only to a caller holding `crm.config.write:all`, and the commands and
 * policies decide what each change may reach.
 */
export async function listPipelineSettings(ctx: ReadContext): Promise<PipelineSettingsViewDto[]> {
  const p = schema.pipelines;
  const pipelines = await ctx.tx
    .select()
    .from(p)
    .where(and(eq(p.isActive, true), isNull(p.archivedAt)))
    .orderBy(asc(p.name), asc(p.id));
  if (pipelines.length === 0) return [];
  const st = schema.pipelineStages;
  const stages = await ctx.tx
    .select()
    .from(st)
    .where(
      and(
        inArray(
          st.pipelineId,
          pipelines.map((r) => r.id),
        ),
        isNull(st.archivedAt),
      ),
    )
    .orderBy(asc(st.position));
  return pipelines.map((row) =>
    PipelineSettingsViewDto.parse({
      pipeline: {
        id: row.id,
        entityId: row.entityId,
        key: row.key,
        name: row.name,
        segment: row.segment,
        lockHours: row.lockHours,
        firstContactSlaMinutes: row.firstContactSlaMinutes,
        updatedAt: row.updatedAt.toISOString(),
      },
      stages: stages.filter((s) => s.pipelineId === row.id).map(toStageDto),
    }),
  );
}

function scopeOf(
  entityColumn: AnyPgColumn,
  segmentColumn: AnyPgColumn,
  input: ConfigScopeInput,
): SQL {
  const company = input.entityId === null ? isNull(entityColumn) : eq(entityColumn, input.entityId);
  const kind = input.segment === null ? isNull(segmentColumn) : eq(segmentColumn, input.segment);
  return sql`${company} and ${kind}`;
}

/** The live call outcomes of exactly one scope, by position; empty when the scope has none. */
export async function listDispositions(
  ctx: ReadContext,
  input: ConfigScopeInput,
): Promise<DispositionListDto> {
  const cd = schema.callDispositions;
  const rows = await ctx.tx
    .select()
    .from(cd)
    .where(and(scopeOf(cd.entityId, cd.segment, input), isNull(cd.archivedAt)))
    .orderBy(asc(cd.position));
  return DispositionListDto.parse({
    entityId: input.entityId,
    segment: input.segment,
    dispositions: rows.map((r) =>
      DispositionDto.parse({
        id: r.id,
        entityId: r.entityId,
        segment: r.segment,
        key: r.key,
        code: r.code,
        label: r.label,
        nextAction: DispositionNextActionSchema.parse(r.nextAction),
      }),
    ),
  });
}

/** The live score rules of exactly one scope, in the order the Executive set them. */
export async function listScoreRules(
  ctx: ReadContext,
  input: ConfigScopeInput,
): Promise<ScoreRuleDto[]> {
  const r = schema.leadScoreRules;
  const rows = await ctx.tx
    .select()
    .from(r)
    .where(and(scopeOf(r.entityId, r.segment, input), isNull(r.archivedAt)))
    .orderBy(asc(r.position));
  return rows.map((row) =>
    ScoreRuleDto.parse({
      id: row.id,
      entityId: row.entityId,
      segment: row.segment,
      factor: ScoreFactorSchema.parse(row.factor),
      match: row.matchJson,
      points: row.points,
    }),
  );
}
