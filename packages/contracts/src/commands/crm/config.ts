import { z } from 'zod';
import {
  CommissionBasisSchema,
  CommissionTriggerSchema,
  DispositionCodeSchema,
  DispositionNextActionSchema,
  ReferralCodeSchema,
  ScoreFactorSchema,
  SystemSizeUnitSchema,
} from '../../crm/config';
import { SegmentSchema, StageExitFieldSchema, StageKindSchema } from '../../crm/enums';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * The CRM set-up an Executive changes without code (docs/design/phase1.md §6.6): pipelines and
 * their stages, the call outcomes, the lead score rules, referral partners and their commission
 * rules. Every command here but `crm.lead.rescore` and `crm.referral_partner.set` needs
 * `crm.config.write:all`.
 */

const Name = z.string().trim().min(2).max(60);

/** `lock_hours`: 1 hour to 30 days (CALL-4). */
export const LockHoursSchema = z.number().int().min(1).max(720);
/** `first_contact_sla_minutes`: 1 minute to 7 days; null sets no limit. */
export const FirstContactSlaSchema = z.number().int().min(1).max(10_080);

// --- Pipelines and stages ---------------------------------------------------------------------

export const UpdatePipelineInput = z
  .object({
    pipelineId: IdSchema,
    name: Name.optional(),
    lockHours: LockHoursSchema.optional(),
    firstContactSlaMinutes: FirstContactSlaSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.name !== undefined || v.lockHours !== undefined || v.firstContactSlaMinutes !== undefined,
    { message: 'nothing to change', path: ['name'] },
  );
export type UpdatePipelineInput = z.infer<typeof UpdatePipelineInput>;

export const PipelineSettingsDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema.nullable(),
    key: z.string(),
    name: z.string(),
    segment: SegmentSchema,
    lockHours: z.number().int(),
    firstContactSlaMinutes: z.number().int().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type PipelineSettingsDto = z.infer<typeof PipelineSettingsDto>;

const RequiredFields = z
  .array(StageExitFieldSchema)
  .max(10)
  .refine((v) => new Set(v).size === v.length, { message: 'each detail once' });

export const StageSettingsDto = z
  .object({
    id: IdSchema,
    pipelineId: IdSchema,
    key: z.string(),
    name: z.string(),
    position: z.number().int(),
    kind: StageKindSchema,
    requiredFields: z.array(StageExitFieldSchema),
    archived: z.boolean(),
  })
  .strict();
export type StageSettingsDto = z.infer<typeof StageSettingsDto>;

/** A stage is added as the last open stage of its pipeline, before Won and Lost. */
export const CreateStageInput = z.object({ pipelineId: IdSchema, name: Name }).strict();
export type CreateStageInput = z.infer<typeof CreateStageInput>;

export const UpdateStageInput = z
  .object({
    stageId: IdSchema,
    name: Name.optional(),
    /** The details a lead must have before it leaves the stage; open stages only. */
    requiredFields: RequiredFields.optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.requiredFields !== undefined, {
    message: 'nothing to change',
    path: ['name'],
  });
export type UpdateStageInput = z.infer<typeof UpdateStageInput>;

/** The pipeline's open stages in their new order: every one, each once. */
export const ReorderStagesInput = z
  .object({
    pipelineId: IdSchema,
    stageIds: z
      .array(IdSchema)
      .min(1)
      .max(30)
      .refine((v) => new Set(v).size === v.length, { message: 'each stage once' }),
  })
  .strict();
export type ReorderStagesInput = z.infer<typeof ReorderStagesInput>;

export const StageSettingsListDto = z
  .object({ pipelineId: IdSchema, stages: z.array(StageSettingsDto) })
  .strict();
export type StageSettingsListDto = z.infer<typeof StageSettingsListDto>;

export const ArchiveStageInput = z.object({ stageId: IdSchema }).strict();
export type ArchiveStageInput = z.infer<typeof ArchiveStageInput>;

// --- Call outcomes ----------------------------------------------------------------------------

/** A scope of set-up rows: the group (`entityId` null) or one company, one segment or all. */
const ScopeFields = {
  entityId: EntityIdSchema.nullable(),
  segment: SegmentSchema.nullable(),
};

export const DispositionInput = z
  .object({
    key: z.number().int().min(1).max(9),
    /** Kept from the row it replaces; a new outcome takes one made from its label. */
    code: DispositionCodeSchema.optional(),
    label: z.string().trim().min(2).max(40),
    nextAction: DispositionNextActionSchema,
  })
  .strict();
export type DispositionInput = z.infer<typeof DispositionInput>;

/** `crm.disposition.set`: the scope's list, replaced as a set. An empty list clears the scope. */
export const SetDispositionsInput = z
  .object({
    ...ScopeFields,
    dispositions: z
      .array(DispositionInput)
      .max(9)
      .refine((v) => new Set(v.map((d) => d.key)).size === v.length, {
        message: 'each number key once',
      })
      .refine((v) => new Set(v.map((d) => d.label.toLowerCase())).size === v.length, {
        message: 'each outcome once',
      }),
  })
  .strict();
export type SetDispositionsInput = z.infer<typeof SetDispositionsInput>;

export const DispositionDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema.nullable(),
    segment: SegmentSchema.nullable(),
    key: z.number().int(),
    code: z.string(),
    label: z.string(),
    nextAction: DispositionNextActionSchema,
  })
  .strict();
export type DispositionDto = z.infer<typeof DispositionDto>;

export const DispositionListDto = z
  .object({ ...ScopeFields, dispositions: z.array(DispositionDto) })
  .strict();
export type DispositionListDto = z.infer<typeof DispositionListDto>;

// --- Lead scoring -----------------------------------------------------------------------------

const Points = z
  .number()
  .int()
  .min(-50)
  .max(50)
  .refine((v) => v !== 0, { message: 'a rule adds or takes away points' });

const between = (min: number | undefined, max: number | undefined) =>
  (min !== undefined || max !== undefined) &&
  (min === undefined || max === undefined || min <= max);

/** What each factor matches, as `lead_score_rules.match_json` stores it. */
export const ScoreMatchSchemas = {
  source: z
    .object({ sourceCodes: z.array(z.string().trim().min(1).max(40)).min(1).max(20) })
    .strict(),
  segment: z.object({ segments: z.array(SegmentSchema).min(1).max(4) }).strict(),
  district: z
    .object({ districts: z.array(z.string().trim().min(2).max(60)).min(1).max(50) })
    .strict(),
  system_size: z
    .object({
      unit: SystemSizeUnitSchema,
      min: z.number().min(0).max(10_000).optional(),
      max: z.number().min(0).max(10_000).optional(),
    })
    .strict()
    .refine((v) => between(v.min, v.max), { message: 'a size range', path: ['min'] }),
  age_days: z
    .object({
      minDays: z.number().int().min(0).max(3650).optional(),
      maxDays: z.number().int().min(0).max(3650).optional(),
    })
    .strict()
    .refine((v) => between(v.minDays, v.maxDays), { message: 'an age range', path: ['minDays'] }),
} as const satisfies Record<z.infer<typeof ScoreFactorSchema>, z.ZodType>;

export const ScoreRuleInput = z.discriminatedUnion('factor', [
  z
    .object({ factor: z.literal('source'), match: ScoreMatchSchemas.source, points: Points })
    .strict(),
  z
    .object({ factor: z.literal('segment'), match: ScoreMatchSchemas.segment, points: Points })
    .strict(),
  z
    .object({ factor: z.literal('district'), match: ScoreMatchSchemas.district, points: Points })
    .strict(),
  z
    .object({
      factor: z.literal('system_size'),
      match: ScoreMatchSchemas.system_size,
      points: Points,
    })
    .strict(),
  z
    .object({ factor: z.literal('age_days'), match: ScoreMatchSchemas.age_days, points: Points })
    .strict(),
]);
export type ScoreRuleInput = z.infer<typeof ScoreRuleInput>;

/** `crm.score_rule.set`: the scope's rules, replaced as a set; the scope's open leads rescored. */
export const SetScoreRulesInput = z
  .object({ ...ScopeFields, rules: z.array(ScoreRuleInput).max(50) })
  .strict();
export type SetScoreRulesInput = z.infer<typeof SetScoreRulesInput>;

export const ScoreRuleDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema.nullable(),
    segment: SegmentSchema.nullable(),
    factor: ScoreFactorSchema,
    match: z.record(z.string(), z.unknown()),
    points: z.number().int(),
  })
  .strict();
export type ScoreRuleDto = z.infer<typeof ScoreRuleDto>;

export const ScoreRuleListDto = z
  .object({
    ...ScopeFields,
    rules: z.array(ScoreRuleDto),
    /** How many open leads the new rules rescored. */
    rescored: z.number().int(),
  })
  .strict();
export type ScoreRuleListDto = z.infer<typeof ScoreRuleListDto>;

/** One reason in a lead's score: the factor, its points and the catalogue key naming it. */
export const ScoreReasonSchema = z
  .object({
    factor: ScoreFactorSchema,
    points: z.number().int(),
    labelKey: z.string().max(80),
  })
  .strict();
export type ScoreReason = z.infer<typeof ScoreReasonSchema>;

export const RescoreLeadInput = z
  .object({ entityId: EntityIdSchema, opportunityId: IdSchema })
  .strict();
export type RescoreLeadInput = z.infer<typeof RescoreLeadInput>;

export const LeadScoreDto = z
  .object({
    opportunityId: IdSchema,
    score: z.number().int().min(0).max(100),
    reasons: z.array(ScoreReasonSchema),
    scoreChangedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type LeadScoreDto = z.infer<typeof LeadScoreDto>;

// --- Referral partners and commission ---------------------------------------------------------

/** `crm.referral_partner.set`: gives a referral-partner customer its code, or changes it. */
export const SetReferralPartnerInput = z
  .object({ accountId: IdSchema, code: ReferralCodeSchema, isActive: z.boolean() })
  .strict();
export type SetReferralPartnerInput = z.infer<typeof SetReferralPartnerInput>;

export const ReferralPartnerDto = z
  .object({ accountId: IdSchema, code: z.string(), isActive: z.boolean() })
  .strict();
export type ReferralPartnerDto = z.infer<typeof ReferralPartnerDto>;

/** A money or percentage value with at most two decimals, as `numeric(14,2)` stores it. */
const Amount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/)
  .refine((v) => Number(v) > 0, { message: 'more than zero' });

const EffectiveDate = z.iso.date();

/**
 * `crm.commission_rule.set` (workshop CRM-5): a partner's rule, or the group default when
 * `partnerId` is null, from a date. The rule that was open-ended until then ends where the new one
 * starts; an overlap with any other period is refused.
 */
export const SetCommissionRuleInput = z
  .object({
    partnerId: IdSchema.nullable(),
    basis: CommissionBasisSchema,
    amount: Amount,
    effectiveFrom: EffectiveDate,
    effectiveTo: EffectiveDate.optional(),
  })
  .strict()
  .refine((v) => v.basis !== 'percent' || Number(v.amount) <= 100, {
    message: 'a percentage is at most 100',
    path: ['amount'],
  })
  .refine((v) => v.effectiveTo === undefined || v.effectiveTo > v.effectiveFrom, {
    message: 'the end date must be after the start',
    path: ['effectiveTo'],
  });
export type SetCommissionRuleInput = z.infer<typeof SetCommissionRuleInput>;

export const CommissionRuleDto = z
  .object({
    id: IdSchema,
    partnerId: IdSchema.nullable(),
    basis: CommissionBasisSchema,
    amount: z.string(),
    trigger: CommissionTriggerSchema,
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
  })
  .strict();
export type CommissionRuleDto = z.infer<typeof CommissionRuleDto>;

// --- Reads of the pipelines settings page ------------------------------------------------------

/** A pipeline as the settings page edits it, with its live stages in order. */
export const PipelineSettingsViewDto = z
  .object({ pipeline: PipelineSettingsDto, stages: z.array(StageSettingsDto) })
  .strict();
export type PipelineSettingsViewDto = z.infer<typeof PipelineSettingsViewDto>;

/** One scope of call outcomes or score rules, as the settings page reads it. */
export const ConfigScopeInput = z.object(ScopeFields).strict();
export type ConfigScopeInput = z.infer<typeof ConfigScopeInput>;
