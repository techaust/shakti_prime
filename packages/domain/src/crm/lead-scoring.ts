import {
  ScoreFactorSchema,
  ScoreReasonSchema,
  SegmentSchema,
  type ScoreReason,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { CommandContext } from '../command/context';
import { scoreLead, type LeadScore, type ScoreFacts, type ScoreRule } from './score';

/**
 * Loading what `scoreLead()` reads and writing what it answers, for one lead or for every open
 * lead a changed rule set reaches. Everything is read and written under the caller's own
 * policies: a lead the caller cannot read is not scored, and one outside their write scope is
 * refused by the update policy.
 */

export interface ScoredLead extends ScoreFacts {
  id: string;
  score: number;
  reasons: ScoreReason[];
}

const Reasons = z.array(ScoreReasonSchema);

/** The stored reasons of a lead; a list that cannot be read counts as none. */
function storedReasons(value: unknown): ScoreReason[] {
  const parsed = Reasons.safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** The facts of the leads `where` selects, in id order, at most `limit` of them. */
export async function loadScoreFacts(
  ctx: CommandContext,
  where: SQL,
  limit: number,
): Promise<ScoredLead[]> {
  const o = schema.opportunities;
  const p = schema.pipelines;
  const ls = schema.leadSources;
  const cs = schema.customerSites;
  const rows = await ctx.tx
    .select({
      id: o.id,
      entityId: o.entityId,
      segment: p.segment,
      sourceCode: ls.code,
      district: cs.district,
      createdAt: o.createdAt,
      score: o.score,
      reasons: o.scoreReasonsJson,
    })
    .from(o)
    .innerJoin(p, eq(p.id, o.pipelineId))
    .leftJoin(ls, eq(ls.id, o.sourceId))
    .leftJoin(cs, eq(cs.id, o.siteId))
    .where(where)
    .orderBy(asc(o.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    entityId: r.entityId,
    segment: SegmentSchema.parse(r.segment),
    sourceCode: r.sourceCode,
    district: r.district,
    // The sizing panel records the system size (design §6.7); until then no lead has one.
    systemSize: { kw: null, hp: null },
    createdAt: r.createdAt,
    score: r.score,
    reasons: storedReasons(r.reasons),
  }));
}

/** The live rules that may apply in the given companies: the group's and those companies' own. */
export async function loadScoreRules(
  ctx: CommandContext,
  entityIds: readonly number[],
): Promise<ScoreRule[]> {
  const r = schema.leadScoreRules;
  const rows = await ctx.tx
    .select({
      entityId: r.entityId,
      segment: r.segment,
      factor: r.factor,
      match: r.matchJson,
      points: r.points,
    })
    .from(r)
    .where(
      and(
        isNull(r.archivedAt),
        entityIds.length === 0
          ? isNull(r.entityId)
          : or(isNull(r.entityId), inArray(r.entityId, [...entityIds])),
      ),
    )
    // Group rules first, then a company's, each in the order the Executive set them.
    .orderBy(sql`${r.entityId} nulls first`, sql`${r.segment} nulls first`, asc(r.position));
  return rows.map((row) => ({
    entityId: row.entityId,
    segment: row.segment === null ? null : SegmentSchema.parse(row.segment),
    factor: ScoreFactorSchema.parse(row.factor),
    match: row.match,
    points: row.points,
  }));
}

/** Whether a new score or its reasons differ from what the lead holds. */
export function scoreChanged(
  lead: Pick<ScoredLead, 'score' | 'reasons'>,
  next: LeadScore,
): boolean {
  return lead.score !== next.score || JSON.stringify(lead.reasons) !== JSON.stringify(next.reasons);
}

/**
 * Writes new scores for the given leads in one statement, stamped with the caller and the time.
 * Answers how many rows the update policy let through.
 */
export async function writeScores(
  ctx: CommandContext,
  changes: readonly { id: string; next: LeadScore }[],
): Promise<number> {
  if (changes.length === 0) return 0;
  const values = sql.join(
    changes.map(
      (c) => sql`(${c.id}::uuid, ${c.next.score}::int, ${JSON.stringify(c.next.reasons)}::jsonb)`,
    ),
    sql`, `,
  );
  const updated = (await ctx.tx.execute(sql`
    update opportunities o
       set score = v.score,
           score_reasons_json = v.reasons,
           score_changed_at = ${ctx.now.toISOString()}::timestamptz,
           score_changed_by = ${ctx.principal.id}::uuid,
           updated_by = ${ctx.principal.id}::uuid
      from (values ${values}) as v(id, score, reasons)
     where o.id = v.id
    returning o.id`)) as unknown as { id: string }[];
  return updated.length;
}

/** Scores the leads and answers only those whose score or reasons change. */
export function rescore(
  leads: readonly ScoredLead[],
  rules: readonly ScoreRule[],
  now: Date,
): { id: string; before: number; next: LeadScore }[] {
  return leads.flatMap((lead) => {
    const next = scoreLead(lead, rules, now);
    return scoreChanged(lead, next) ? [{ id: lead.id, before: lead.score, next }] : [];
  });
}
