import { LeadSourceDto, PipelineDto, SegmentSchema, StageKindSchema } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

type ReadContext = Pick<RequestContext, 'tx'>;

/**
 * Active pipelines the request's companies can use, each with its stages in order: the lead
 * form's choices and the stage names on the leads list. RLS keeps a company's own pipeline from
 * the others; a shared pipeline (no company) is visible to all.
 */
export async function listPipelines(ctx: ReadContext): Promise<PipelineDto[]> {
  const p = schema.pipelines;
  const pipelines = await ctx.tx
    .select()
    .from(p)
    .where(and(eq(p.isActive, true), isNull(p.archivedAt)))
    .orderBy(asc(p.name), asc(p.id));
  if (pipelines.length === 0) return [];
  const st = schema.pipelineStages;
  const stages = await ctx.tx
    .select({ id: st.id, pipelineId: st.pipelineId, key: st.key, name: st.name, kind: st.kind })
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
    PipelineDto.parse({
      id: row.id,
      key: row.key,
      name: row.name,
      segment: SegmentSchema.parse(row.segment),
      entityId: row.entityId,
      stages: stages
        .filter((s) => s.pipelineId === row.id)
        .map((s) => ({ id: s.id, key: s.key, name: s.name, kind: StageKindSchema.parse(s.kind) })),
    }),
  );
}

/** Active lead sources, by name, for the lead form. */
export async function listLeadSources(ctx: ReadContext): Promise<LeadSourceDto[]> {
  const ls = schema.leadSources;
  const rows = await ctx.tx
    .select({ code: ls.code, name: ls.name })
    .from(ls)
    .where(and(eq(ls.isActive, true), isNull(ls.archivedAt)))
    .orderBy(asc(ls.name));
  return rows.map((r) => LeadSourceDto.parse(r));
}
