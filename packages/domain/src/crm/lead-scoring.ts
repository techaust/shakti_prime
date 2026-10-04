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
import { canonicalJson } from '../idempotency/hash';
import { scoreLead, type LeadScore, type ScoreFacts, type ScoreRule } from './score';

/**
 * Loading what `scoreLead()` reads and writing what it answers, for one lead or for every open
 * lead a changed rule set reaches. Everything is read and written under the caller's own
 * policies: a lead the caller cannot read is not scored, and one outside their write scope is
 * refused by the update policy. The nightly rescoring alone reads and writes through the two
 * definers of `crm.score.refresh` (`loadRefreshFacts`, `writeRefreshedScores`), because the worker
 * principal holds no `crm.*` permission a person may hold (ADR 0020).
 *
 * A score write changes only the score columns, so the lead keeps its `updated_at` and
 * `updated_by` (the trigger `app.opportunities_set_updated_at()`): the leads grid's order by last
 * change follows people's edits, and `score_changed_at` and `score_changed_by` record the score's.
 */

export interface ScoredLead extends ScoreFacts {
  id: string;
  score: number;
  reasons: ScoreReason[];
  /** When the score last changed, as the database wrote it; read only by the nightly rescoring. */
  seen?: string | null;
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
  return lead.score !== next.score || canonicalJson(lead.reasons) !== canonicalJson(next.reasons);
}

/**
 * Writes new scores for the given leads in one statement, stamped as the score's change with the
 * caller and the time; the lead's own `updated_at` and `updated_by` stay as they were. Answers how
 * many rows the update policy let through.
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
           score_changed_by = ${ctx.principal.id}::uuid
      from (values ${values}) as v(id, score, reasons)
     where o.id = v.id
    returning o.id`)) as unknown as { id: string }[];
  return updated.length;
}

/** A row of `app.lead_score_facts()`. */
interface RefreshFactRow {
  lead_id: string;
  lead_segment: string;
  source_code: string | null;
  site_district: string | null;
  lead_created_at: Date | string;
  lead_score: number;
  lead_reasons: unknown;
  score_seen: string | null;
}

/**
 * The nightly rescoring's read (`crm.score.refresh`): the facts of the next `limit` open and
 * nurture leads of one company after `afterId`, in id order, through the definer
 * `app.lead_score_facts()`, which answers nothing else of a lead.
 */
export async function loadRefreshFacts(
  ctx: CommandContext,
  entityId: number,
  afterId: string | null,
  limit: number,
): Promise<ScoredLead[]> {
  const rows = (await ctx.tx.execute(sql`
    select * from app.lead_score_facts(${entityId}::smallint, ${afterId}::uuid, ${limit}::int)`)) as unknown as RefreshFactRow[];
  return rows.map((r) => ({
    id: r.lead_id,
    entityId,
    segment: SegmentSchema.parse(r.lead_segment),
    sourceCode: r.source_code,
    district: r.site_district,
    systemSize: { kw: null, hp: null },
    createdAt: new Date(r.lead_created_at),
    score: r.lead_score,
    reasons: storedReasons(r.lead_reasons),
    seen: r.score_seen,
  }));
}

/**
 * The nightly rescoring's write (`crm.score.refresh`): the new scores of leads of one company,
 * through the definer `app.write_lead_scores()`, which touches only the score columns and skips a
 * lead whose score changed since it was read (`seen`), so a rule change committed meanwhile is
 * never overwritten with a score made from the rules read before it. Answers how many it wrote.
 */
export async function writeRefreshedScores(
  ctx: CommandContext,
  entityId: number,
  changes: readonly { id: string; next: LeadScore; seen: string | null }[],
): Promise<number> {
  if (changes.length === 0) return 0;
  const scores = changes.map((c) => ({
    id: c.id,
    score: c.next.score,
    reasons: c.next.reasons,
    seen: c.seen,
  }));
  const [row] = (await ctx.tx.execute(sql`
    select app.write_lead_scores(${entityId}::smallint, ${JSON.stringify(scores)}::jsonb) as written`)) as unknown as {
    written: number;
  }[];
  return row?.written ?? 0;
}

/** Scores the leads and answers only those whose score or reasons change. */
export function rescore(
  leads: readonly ScoredLead[],
  rules: readonly ScoreRule[],
  now: Date,
): { id: string; before: number; next: LeadScore; seen: string | null }[] {
  return leads.flatMap((lead) => {
    const next = scoreLead(lead, rules, now);
    return scoreChanged(lead, next)
      ? [{ id: lead.id, before: lead.score, next, seen: lead.seen ?? null }]
      : [];
  });
}
