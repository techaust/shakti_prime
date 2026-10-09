import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';
import { CalendarDateSchema } from '../../tax/engine';

/** Whose target it is: one caller's, or a whole team's (design §9, PRD TEL-06). */
export const TargetScopeSchema = z.enum(['caller', 'team']);
export type TargetScope = z.infer<typeof TargetScopeSchema>;

/**
 * What a target counts: calls logged, leads moved to qualified, orders confirmed, and the kW of
 * the leads whose orders were confirmed. The rule for each is in `app.target_actuals()`.
 */
export const TargetMetricSchema = z.enum(['calls', 'qualified', 'orders', 'kw']);
export type TargetMetric = z.infer<typeof TargetMetricSchema>;

/** The length of a target's period: a day, a week (Monday to Sunday) or a month, in IST. */
export const TargetPeriodSchema = z.enum(['day', 'week', 'month']);
export type TargetPeriod = z.infer<typeof TargetPeriodSchema>;

/** The largest target one number takes: a count or a kW figure, never a typing slip. */
export const TARGET_VALUE_MAX = 1_000_000;

/** A target figure: a number from 0 (no target) with at most two decimals. */
export const TargetValueSchema = z
  .number()
  .min(0)
  .max(TARGET_VALUE_MAX)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: 'at most two decimals',
  });

/**
 * `sales.target.set` (design §9, PRD TEL-06): the target of one caller or one team for a metric
 * and a period, as it stands from the period that starts on `startsOn` (the day itself, a
 * Monday, or the first of a month, in IST) until a newer target is set. A value of 0 takes the
 * target away. The client gives the figures; nothing is filled in.
 */
export const SetTargetInput = z
  .object({
    entityId: EntityIdSchema,
    scope: TargetScopeSchema,
    /** The person (`caller`) or the team (`team`). */
    subjectId: IdSchema,
    metric: TargetMetricSchema,
    period: TargetPeriodSchema,
    startsOn: CalendarDateSchema,
    value: TargetValueSchema,
  })
  .strict();
export type SetTargetInput = z.input<typeof SetTargetInput>;

/** One target as it was set. */
export const TargetDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    scope: TargetScopeSchema,
    subjectId: IdSchema,
    subjectName: z.string().nullable(),
    teamId: IdSchema,
    metric: TargetMetricSchema,
    period: TargetPeriodSchema,
    startsOn: CalendarDateSchema,
    value: z.number(),
    setAt: z.iso.datetime(),
    setByName: z.string().nullable(),
  })
  .strict();
export type TargetDto = z.infer<typeof TargetDto>;

/** `targets.screen`: what the Targets page of one company shows. */
export const TargetsScreenInput = z
  .object({ entityId: EntityIdSchema, historyLimit: z.number().int().min(1).max(100).default(30) })
  .strict();
export type TargetsScreenInput = z.input<typeof TargetsScreenInput>;

/** A person or team a target can be set for. */
export const TargetSubjectDto = z
  .object({
    scope: TargetScopeSchema,
    id: IdSchema,
    name: z.string(),
    teamId: IdSchema,
  })
  .strict();
export type TargetSubjectDto = z.infer<typeof TargetSubjectDto>;

/** The first day of each period that holds today, for the form's default. */
export const TargetsScreenDto = z
  .object({
    entityId: EntityIdSchema,
    subjects: z.array(TargetSubjectDto),
    /** The target in force today for each subject, metric and period (a value of 0 left out). */
    current: z.array(TargetDto),
    /** The newest targets set, a value of 0 included, newest first. */
    history: z.array(TargetDto),
    periodStarts: z.object({ day: CalendarDateSchema, week: CalendarDateSchema, month: CalendarDateSchema }),
  })
  .strict();
export type TargetsScreenDto = z.infer<typeof TargetsScreenDto>;

/** One metric's target and what was done against it in a period. */
export const MetricProgressDto = z
  .object({
    metric: TargetMetricSchema,
    /** The target in force, or null when none is set. */
    target: z.number().nullable(),
    actual: z.number(),
    /** `actual` over `target` (1 is met), or null when there is no target. */
    fraction: z.number().nullable(),
  })
  .strict();
export type MetricProgressDto = z.infer<typeof MetricProgressDto>;

/** A period and the progress of one subject in it. */
export const PeriodProgressDto = z
  .object({
    period: TargetPeriodSchema,
    startsOn: CalendarDateSchema,
    /** The last day of the period. */
    endsOn: CalendarDateSchema,
    metrics: z.array(MetricProgressDto),
  })
  .strict();
export type PeriodProgressDto = z.infer<typeof PeriodProgressDto>;

/** `targets.mine`: the signed-in person's progress, per company. */
export const MyProgressInput = z.object({}).strict();
export type MyProgressInput = z.input<typeof MyProgressInput>;
export const MyProgressDto = z
  .object({
    entityId: EntityIdSchema,
    periods: z.array(PeriodProgressDto),
  })
  .strict();
export type MyProgressDto = z.infer<typeof MyProgressDto>;

/** `targets.team`: a team's progress and its callers' leaderboard for a period. */
export const TeamProgressInput = z
  .object({
    entityId: EntityIdSchema.optional(),
    period: TargetPeriodSchema.default('day'),
    /** The metric the leaderboard is ranked by. */
    metric: TargetMetricSchema.default('calls'),
  })
  .strict();
export type TeamProgressInput = z.input<typeof TeamProgressInput>;

export const LeaderboardRowDto = z
  .object({
    callerId: IdSchema,
    callerName: z.string(),
    metrics: z.array(MetricProgressDto),
  })
  .strict();
export type LeaderboardRowDto = z.infer<typeof LeaderboardRowDto>;

export const TeamProgressDto = z
  .object({
    entityId: EntityIdSchema,
    teamId: IdSchema,
    teamName: z.string(),
    period: TargetPeriodSchema,
    startsOn: CalendarDateSchema,
    endsOn: CalendarDateSchema,
    metric: TargetMetricSchema,
    /** The team's target against the sum of its callers' figures. */
    team: z.array(MetricProgressDto),
    leaderboard: z.array(LeaderboardRowDto),
  })
  .strict();
export type TeamProgressDto = z.infer<typeof TeamProgressDto>;
