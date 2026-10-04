import {
  DomainError,
  LeadScoreDto,
  LeadScoreRefreshDto,
  newId,
  RefreshLeadScoresInput,
  RescoreLeadInput,
  ScoreFactorSchema,
  ScoreRuleDto,
  ScoreRuleListDto,
  SetScoreRulesInput,
  type Segment,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import {
  loadRefreshFacts,
  loadScoreFacts,
  loadScoreRules,
  rescore,
  writeRefreshedScores,
  writeScores,
} from '../../crm/lead-scoring';
import { canonicalJson } from '../../idempotency/hash';
import { scoreLead } from '../../crm/score';
import { assertConfigScope } from './config-scope';
import { lockOpportunity, requireEntity } from './opportunity-shared';

type RuleRow = typeof schema.leadScoreRules.$inferSelect;
const r = schema.leadScoreRules;
const o = schema.opportunities;

/** How many leads one rescoring statement writes. */
export const RESCORE_BATCH = 1000;

function ruleScope(entityId: number | null, segment: Segment | null): SQL {
  const company = entityId === null ? isNull(r.entityId) : eq(r.entityId, entityId);
  const kind = segment === null ? isNull(r.segment) : eq(r.segment, segment);
  return sql`${company} and ${kind}`;
}

function toRuleDto(row: RuleRow): ScoreRuleDto {
  return ScoreRuleDto.parse({
    id: row.id,
    entityId: row.entityId,
    segment: row.segment,
    factor: ScoreFactorSchema.parse(row.factor),
    match: row.matchJson,
    points: row.points,
  });
}

/**
 * A rule's identity for comparing two lists: its factor, what it matches and its points, with the
 * match's keys in sorted order, so a rule saved again as it was reads as unchanged.
 */
function signature(rule: { factor: string; match: unknown; points: number }): string {
  return canonicalJson([rule.factor, rule.match, rule.points]);
}

/**
 * Rescores every open or nurture lead a rule scope reaches, in batches of `RESCORE_BATCH` read by
 * id, with every live rule that applies to each lead. Answers how many leads changed, and writes
 * one audit row per batch that changed any (the import batches' rule, design §8).
 */
export async function rescoreScope(
  ctx: CommandContext,
  entityId: number | null,
  segment: Segment | null,
): Promise<number> {
  const rules = await loadScoreRules(ctx, ctx.entityIds);
  const p = schema.pipelines;
  const inScope = sql.join(
    [
      isNull(o.archivedAt),
      inArray(o.state, ['open', 'nurture']),
      entityId === null ? inArray(o.entityId, [...ctx.entityIds]) : eq(o.entityId, entityId),
      ...(segment === null ? [] : [eq(p.segment, segment)]),
    ],
    sql` and `,
  );
  let after: string | undefined;
  let total = 0;
  let batch = 0;
  for (;;) {
    const leads = await loadScoreFacts(
      ctx,
      after === undefined ? inScope : sql`${inScope} and ${gt(o.id, after)}`,
      RESCORE_BATCH,
    );
    if (leads.length === 0) break;
    after = leads.at(-1)?.id;
    const changes = rescore(leads, rules, ctx.now);
    const written = await writeScores(ctx, changes);
    if (written !== changes.length) {
      throw new DomainError('forbidden', 'a lead in scope is outside the caller write scope');
    }
    if (written > 0) {
      batch += 1;
      total += written;
      ctx.audit({
        aggregateType: 'lead_score_batch',
        aggregateId: newId(),
        entityId,
        before: null,
        after: { batch, rows: written },
      });
    }
    if (leads.length < RESCORE_BATCH) break;
  }
  return total;
}

/**
 * `crm.score_rule.set` (CRM-06, workshop CRM-3): replaces a scope's score rules as a set, then
 * rescores the scope's open and nurture leads in the same transaction. The rescoring runs here
 * rather than in a worker so the calling queue never orders by a mix of old and new rules: the
 * Executive changes rules rarely, the leads are written a thousand to a statement, and a change
 * either lands with every score it implies or not at all.
 */
export const setScoreRules = defineCommand({
  name: 'crm.score_rule.set',
  permission: 'crm.config.write',
  minScope: 'all',
  alsoRequires: [{ permission: 'crm.lead.write', minScope: 'entity' }],
  input: SetScoreRulesInput,
  output: ScoreRuleListDto,
  auditFields: ['factor', 'scorePoints', 'segment', 'archivedAt', 'batch', 'rows'],
  async handler(ctx, input) {
    await assertConfigScope(ctx, input.entityId);
    const current = await ctx.tx
      .select()
      .from(r)
      .where(and(ruleScope(input.entityId, input.segment), isNull(r.archivedAt)))
      .orderBy(asc(r.position))
      .for('update');
    const unchanged =
      current.length === input.rules.length &&
      current.every(
        (row, i) =>
          signature({ factor: row.factor, match: row.matchJson, points: row.points }) ===
          signature(input.rules[i] ?? { factor: '', match: null, points: 0 }),
      );
    if (unchanged) {
      return ScoreRuleListDto.parse({
        entityId: input.entityId,
        segment: input.segment,
        rules: current.map(toRuleDto),
        rescored: 0,
      });
    }

    const actor = ctx.principal.id;
    if (current.length > 0) {
      await ctx.tx
        .update(r)
        .set({ archivedAt: ctx.now, updatedBy: actor })
        .where(
          inArray(
            r.id,
            current.map((row) => row.id),
          ),
        );
      for (const row of current) {
        ctx.audit({
          aggregateType: 'lead_score_rule',
          aggregateId: row.id,
          entityId: row.entityId,
          before: { factor: row.factor, scorePoints: row.points, archivedAt: null },
          after: { archivedAt: ctx.now.toISOString() },
        });
      }
    }
    const rows = input.rules.map((rule, i) => ({
      id: newId(),
      entityId: input.entityId,
      segment: input.segment,
      factor: rule.factor,
      matchJson: rule.match,
      points: rule.points,
      position: i + 1,
      createdBy: actor,
    }));
    if (rows.length > 0) await ctx.tx.insert(r).values(rows);
    for (const row of rows) {
      ctx.audit({
        aggregateType: 'lead_score_rule',
        aggregateId: row.id,
        entityId: row.entityId,
        before: null,
        after: { factor: row.factor, scorePoints: row.points, segment: row.segment },
      });
    }

    const rescored = await rescoreScope(ctx, input.entityId, input.segment);
    const live = await ctx.tx
      .select()
      .from(r)
      .where(and(ruleScope(input.entityId, input.segment), isNull(r.archivedAt)))
      .orderBy(asc(r.position));
    return ScoreRuleListDto.parse({
      entityId: input.entityId,
      segment: input.segment,
      rules: live.map(toRuleDto),
      rescored,
    });
  },
});

/** `crm.lead.rescore`: one lead scored again with the rules that apply to it now. */
export const rescoreLead = defineCommand({
  name: 'crm.lead.rescore',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: RescoreLeadInput,
  output: LeadScoreDto,
  auditFields: ['score'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockOpportunity(ctx, input);
    const [lead] = await loadScoreFacts(ctx, eq(o.id, row.id), 1);
    if (!lead) throw new DomainError('internal', `lead ${row.id} has no pipeline`);
    const rules = await loadScoreRules(ctx, [row.entityId]);
    const next = scoreLead(lead, rules, ctx.now);
    const [change] = rescore([lead], rules, ctx.now);
    if (change) {
      const written = await writeScores(ctx, [change]);
      if (written !== 1) {
        throw new DomainError('forbidden', `lead ${row.id} is outside the caller's write scope`);
      }
      ctx.audit({
        aggregateType: 'opportunity',
        aggregateId: row.id,
        entityId: row.entityId,
        before: { score: lead.score },
        after: { score: next.score },
      });
    }
    return LeadScoreDto.parse({
      opportunityId: row.id,
      score: next.score,
      reasons: next.reasons,
      scoreChangedAt: change ? ctx.now.toISOString() : (row.scoreChangedAt?.toISOString() ?? null),
    });
  },
});

/**
 * `crm.lead.score_refresh` (CRM-06): the next `RESCORE_BATCH` open and nurture leads of a company,
 * in id order after `afterId`, scored again with the rules that apply to them now. A score is
 * written when a rule changes (`crm.score_rule.set`) and when a lead is made; this catches what
 * moves without either: the age of a lead (`age_days` rules) and the details it gained since, such
 * as its site's district. The nightly rescoring worker runs it batch by batch as `system:workers`
 * (`apps/web/src/workers/lead-rescore.ts`); one audit row records each batch that changed a lead.
 *
 * It needs the platform-only `crm.score.refresh`, which no person's role and no agent holds, and
 * reads and writes leads only through its two definers (`loadRefreshFacts`,
 * `writeRefreshedScores`): the worker holds no `crm.*` permission (ADR 0020). A lead whose score
 * changed after this batch read it (a rule change committed meanwhile) is left as it is.
 */
export const refreshLeadScores = defineCommand({
  name: 'crm.lead.score_refresh',
  permission: 'crm.score.refresh',
  minScope: 'entity',
  input: RefreshLeadScoresInput,
  output: LeadScoreRefreshDto,
  auditFields: ['rows'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const rules = await loadScoreRules(ctx, [input.entityId]);
    const leads = await loadRefreshFacts(ctx, input.entityId, input.afterId, RESCORE_BATCH);
    const changes = rescore(leads, rules, ctx.now);
    const written = await writeRefreshedScores(ctx, input.entityId, changes);
    if (written > 0) {
      ctx.audit({
        aggregateType: 'lead_score_batch',
        aggregateId: newId(),
        entityId: input.entityId,
        before: null,
        after: { rows: written },
      });
    }
    return LeadScoreRefreshDto.parse({
      entityId: input.entityId,
      rescored: written,
      nextAfterId: leads.length === RESCORE_BATCH ? (leads.at(-1)?.id ?? null) : null,
    });
  },
});
