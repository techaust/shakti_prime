import { z } from 'zod';
import { PumpSizingInputs, RooftopSizingInputs } from '../commands/crm/sizing';
import { RooftopBoundSchema, SizingReasonSchema } from '../crm/sizing';
import { EntityIdSchema, IdSchema } from '../ids';

/**
 * A sizing as it is stored and read (docs/design/phase1.md §6.7): the inputs, the constants the
 * calculators used, each calculator's result with its bounds, and the engine version. Numbers are
 * SI units as the calculators return them; the panel rounds for display. Strict.
 */
const Bounded = {
  inBounds: z.boolean(),
  reasons: z.array(SizingReasonSchema),
};
const quantity = z.number().min(0);

export const HeadResultSchema = z
  .object({
    staticHeadM: quantity,
    drawdownM: quantity,
    frictionM: quantity,
    fittingsM: quantity,
    tdhM: quantity,
    pipeVelocityMps: quantity,
    ...Bounded,
  })
  .strict();
export type HeadResultDto = z.infer<typeof HeadResultSchema>;

export const PowerResultSchema = z
  .object({
    hydraulicKw: quantity,
    shaftKw: quantity,
    shaftHp: quantity,
    motorInputKw: quantity,
    standardHp: quantity.nullable(),
    standardKw: quantity.nullable(),
    ...Bounded,
  })
  .strict();
export type PowerResultDto = z.infer<typeof PowerResultSchema>;

export const SolarPumpResultSchema = z
  .object({
    requiredKwp: quantity,
    moduleCount: z.number().int().min(0),
    arrayKwp: quantity,
    ...Bounded,
  })
  .strict();
export type SolarPumpResultDto = z.infer<typeof SolarPumpResultSchema>;

export const DutyPointResultSchema = z
  .object({
    dutyFlowLph: quantity.nullable(),
    shutoffHeadM: quantity.nullable(),
    minHeadM: quantity.nullable(),
    ...Bounded,
  })
  .strict();
export type DutyPointResultDto = z.infer<typeof DutyPointResultSchema>;

export const RooftopResultSchema = z
  .object({
    neededKwp: quantity,
    roofKwp: quantity,
    sanctionedKwp: quantity,
    moduleCount: z.number().int().min(0),
    recommendedKwp: quantity,
    boundBy: RooftopBoundSchema,
    ...Bounded,
  })
  .strict();
export type RooftopResultDto = z.infer<typeof RooftopResultSchema>;

/** The engineering constants a pump sizing used (workshop defaults at the time). */
export const PumpSizingConstantsSchema = z
  .object({
    hazenWilliamsC: z.number().positive(),
    fittingsLossFraction: quantity,
    pumpEfficiency: z.number().positive().max(1),
    motorEfficiency: z.number().positive().max(1),
    standardHp: z.array(z.number().positive()),
    /** Solar drive only. */
    arrayOversize: z.number().positive().nullable(),
    /** Solar drive only. */
    moduleWp: z.number().positive().nullable(),
  })
  .strict();
export type PumpSizingConstants = z.infer<typeof PumpSizingConstantsSchema>;

/** The engineering constants a rooftop sizing used. */
export const RooftopSizingConstantsSchema = z
  .object({
    peakSunHours: z.number().positive(),
    performanceRatio: z.number().positive().max(1),
    roofAreaPerKwSqm: z.number().positive(),
    moduleWp: z.number().positive(),
  })
  .strict();
export type RooftopSizingConstants = z.infer<typeof RooftopSizingConstantsSchema>;

export const PumpSizingResultSchema = z
  .object({
    kind: z.literal('pump'),
    constants: PumpSizingConstantsSchema,
    head: HeadResultSchema,
    power: PowerResultSchema,
    /** Solar drive only. */
    solar: SolarPumpResultSchema.nullable(),
    /** Only when a catalogue pump was chosen. */
    dutyPoint: DutyPointResultSchema.nullable(),
  })
  .strict();
export type PumpSizingResult = z.infer<typeof PumpSizingResultSchema>;

export const RooftopSizingResultSchema = z
  .object({
    kind: z.literal('rooftop'),
    constants: RooftopSizingConstantsSchema,
    rooftop: RooftopResultSchema,
  })
  .strict();
export type RooftopSizingResult = z.infer<typeof RooftopSizingResultSchema>;

const SizingBase = {
  id: IdSchema,
  entityId: EntityIdSchema,
  opportunityId: IdSchema,
  siteId: IdSchema.nullable(),
  inBounds: z.boolean(),
  reasons: z.array(SizingReasonSchema),
  engineVersion: z.string().min(1),
  createdAt: z.iso.datetime(),
};

/** A recorded sizing. Strict. */
export const SizingDto = z.discriminatedUnion('kind', [
  z
    .object({
      ...SizingBase,
      kind: z.literal('pump'),
      itemId: IdSchema.nullable(),
      inputs: PumpSizingInputs,
      result: PumpSizingResultSchema,
    })
    .strict(),
  z
    .object({
      ...SizingBase,
      kind: z.literal('rooftop'),
      itemId: z.null(),
      inputs: RooftopSizingInputs,
      result: RooftopSizingResultSchema,
    })
    .strict(),
]);
export type SizingDto = z.infer<typeof SizingDto>;

/** A catalogue pump the sizing panel offers for the duty point: one with a curve. Strict. */
export const SizingPumpDto = z
  .object({ id: IdSchema, sku: z.string().min(1), name: z.string().min(1) })
  .strict();
export type SizingPumpDto = z.infer<typeof SizingPumpDto>;
