import {
  CommissionBasisSchema,
  CommissionRuleRowDto,
  CommissionTriggerSchema,
  DispositionDto,
  DispositionListDto,
  DispositionNextActionSchema,
  PipelineSettingsViewDto,
  REFERRAL_PARTNER_PAGE_SIZE,
  ReferralPartnerPageDto,
  ReferralPartnerRowDto,
  ScoreFactorSchema,
  ScoreRuleDto,
  SegmentSchema,
  type ConfigScopeInput,
  type ListReferralPartnersInput,
  type Segment,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
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

/**
 * The referral partners of the settings page (CRM-09): customers of type `referral_partner` the
 * request's companies know (the `accounts` policy), by name, a page at a time after `cursor`, each
 * with its code if it has one. Served by `accounts_referral_partner_name_idx`.
 */
export async function listReferralPartners(
  ctx: ReadContext,
  input: ListReferralPartnersInput,
): Promise<ReferralPartnerPageDto> {
  const a = schema.accounts;
  const rp = schema.referralPartners;
  const after =
    input.cursor === null
      ? undefined
      : sql`(${a.name}, ${a.id}) > (${input.cursor.name}, ${input.cursor.id}::uuid)`;
  const rows = await ctx.tx
    .select({ accountId: a.id, name: a.name, code: rp.code, isActive: rp.isActive })
    .from(a)
    .leftJoin(rp, eq(rp.accountId, a.id))
    .where(and(eq(a.type, 'referral_partner'), isNull(a.archivedAt), after))
    .orderBy(asc(a.name), asc(a.id))
    .limit(REFERRAL_PARTNER_PAGE_SIZE + 1);
  const page = rows.slice(0, REFERRAL_PARTNER_PAGE_SIZE);
  const last = page.at(-1);
  return ReferralPartnerPageDto.parse({
    partners: page.map((r) => ({
      accountId: r.accountId,
      name: r.name,
      code: r.code,
      isActive: r.isActive ?? false,
    })),
    nextCursor:
      rows.length > REFERRAL_PARTNER_PAGE_SIZE && last
        ? { name: last.name, id: last.accountId }
        : null,
  });
}

/**
 * Every referral partner with a code, accepted or not, whose customer is live and known to the
 * request's companies, by name: what the commission form offers, so a rule can be set for any
 * coded partner whatever page of the list above has been shown. Codes are given one at a time by
 * an Executive, so the list stays short; it is read from `referral_partners` and joined to the
 * customer by its key.
 */
export async function listCodedReferralPartners(ctx: ReadContext): Promise<ReferralPartnerRowDto[]> {
  const a = schema.accounts;
  const rp = schema.referralPartners;
  const rows = await ctx.tx
    .select({ accountId: a.id, name: a.name, code: rp.code, isActive: rp.isActive })
    .from(rp)
    .innerJoin(a, eq(a.id, rp.accountId))
    .where(isNull(a.archivedAt))
    .orderBy(asc(a.name), asc(a.id));
  return rows.map((r) => ReferralPartnerRowDto.parse(r));
}

/**
 * The live commission rules (workshop CRM-5), the default's and each partner's, newest first,
 * with the partner's name. Read with `crm.config.write:all` or `finance.payment.write` (the
 * table's policy); empty until the workshop answers.
 */
export async function listCommissionRules(ctx: ReadContext): Promise<CommissionRuleRowDto[]> {
  const cr = schema.commissionRules;
  const a = schema.accounts;
  const rows = await ctx.tx
    .select({
      id: cr.id,
      partnerId: cr.partnerId,
      partnerName: a.name,
      basis: cr.basis,
      amount: cr.amount,
      trigger: cr.trigger,
      effectiveFrom: cr.effectiveFrom,
      effectiveTo: cr.effectiveTo,
    })
    .from(cr)
    .leftJoin(a, eq(a.id, cr.partnerId))
    .where(isNull(cr.archivedAt))
    .orderBy(sql`${a.name} nulls first`, desc(cr.effectiveFrom), asc(cr.id))
    .limit(500);
  return rows.map((r) =>
    CommissionRuleRowDto.parse({
      ...r,
      basis: CommissionBasisSchema.parse(r.basis),
      trigger: CommissionTriggerSchema.parse(r.trigger),
      // Null for the default, and for a partner whose customer the request cannot read.
      partnerName: r.partnerName,
    }),
  );
}

/** A scope of set-up rows: a company or the group (null), a segment or every segment (null). */
export interface ConfigScope {
  entityId: number | null;
  segment: Segment | null;
}

/**
 * The scopes whose call outcomes apply to a call in `entityId` and `segment`, most specific first:
 * the company's list for that segment, the company's list, the group's list for that segment, the
 * group's list.
 */
export function dispositionPrecedence(entityId: number, segment: Segment): ConfigScope[] {
  return [
    { entityId, segment },
    { entityId, segment: null },
    { entityId: null, segment },
    { entityId: null, segment: null },
  ];
}

/**
 * The list that applies, from rows of any of those scopes: the whole list of the most specific
 * scope that has one, never a mix; undefined when no scope has any.
 */
export function pickEffective<R extends ConfigScope>(
  rows: readonly R[],
  entityId: number,
  segment: Segment,
): { scope: ConfigScope; rows: R[] } | undefined {
  for (const scope of dispositionPrecedence(entityId, segment)) {
    const own = rows.filter((r) => r.entityId === scope.entityId && r.segment === scope.segment);
    if (own.length > 0) return { scope, rows: own };
  }
  return undefined;
}

/**
 * The call outcomes a caller chooses from for a lead of `entityId` in `segment` (TEL-01): the most
 * specific list, replaced whole, never merged. The group's list for every segment is never empty
 * (`crm.disposition.set`), so a caller always has one.
 */
export async function effectiveDispositions(
  ctx: ReadContext,
  entityId: number,
  segment: Segment,
): Promise<DispositionListDto> {
  const cd = schema.callDispositions;
  const rows = await ctx.tx
    .select()
    .from(cd)
    .where(
      and(
        isNull(cd.archivedAt),
        or(isNull(cd.entityId), eq(cd.entityId, entityId)),
        or(isNull(cd.segment), eq(cd.segment, segment)),
      ),
    )
    .orderBy(asc(cd.position));
  const scoped = rows.map((r) => ({
    ...r,
    segment: r.segment === null ? null : SegmentSchema.parse(r.segment),
  }));
  const chosen = pickEffective(scoped, entityId, segment);
  return DispositionListDto.parse({
    entityId: chosen?.scope.entityId ?? null,
    segment: chosen?.scope.segment ?? null,
    dispositions: (chosen?.rows ?? []).map((r) =>
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
