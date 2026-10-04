import { z } from 'zod';
import { PumpTypeSchema } from '../../catalogue/specs';
import { PipeMaterialSchema, PumpDriveSchema, SizingKindSchema } from '../../crm/sizing';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * `crm.sizing.record` (docs/design/phase1.md §6.7): the measurements field staff take, in the
 * units they use. The server runs the calculators on them and never takes a result from the
 * caller; the engineering constants come from the workshop defaults. The limits here only catch
 * typing slips (a depth of 3,000 m); the calculators judge the engineering.
 */
const metres = (max: number) => z.number().min(0).max(max);

export const PumpSizingInputs = z
  .object({
    pumpType: PumpTypeSchema,
    drive: PumpDriveSchema,
    pipeMaterial: PipeMaterialSchema,
    /** Depth from ground level to the water at rest. */
    staticLevelM: metres(500),
    /** Fall of the water level while the pump runs. */
    drawdownM: metres(200),
    /** Height of the outlet above ground level. */
    deliveryHeightM: metres(100),
    /** Pipe from the pump to the outlet. */
    pipeLengthM: metres(3000),
    pipeInnerDiameterMm: z.number().min(10).max(300),
    /** Required flow, in litres per hour. */
    flowLph: z.number().gt(0).max(1_000_000),
  })
  .strict();
export type PumpSizingInputs = z.infer<typeof PumpSizingInputs>;

export const RooftopSizingInputs = z
  .object({
    /** Average monthly consumption from the electricity bills, in units (kWh). */
    monthlyUnitsKwh: z.number().min(0).max(1_000_000),
    /** Shade-free roof area, in square metres. */
    roofAreaSqm: z.number().min(0).max(100_000),
    /** Sanctioned load on the electricity connection, in kW. */
    sanctionedLoadKw: z.number().min(0).max(10_000),
  })
  .strict();
export type RooftopSizingInputs = z.infer<typeof RooftopSizingInputs>;

export const SizingInputs = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('pump'),
      inputs: PumpSizingInputs,
      /** A pump from the catalogue to check against its curve; null to size without one. */
      itemId: IdSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('rooftop'), inputs: RooftopSizingInputs }).strict(),
]);
export type SizingInputs = z.infer<typeof SizingInputs>;

/** The lead the sizing belongs to, the company it is in, and the sizing. */
export const RecordSizingInput = z
  .object({ entityId: EntityIdSchema, opportunityId: IdSchema, sizing: SizingInputs })
  .strict();
export type RecordSizingInput = z.infer<typeof RecordSizingInput>;

/** `latestSizing`: the newest sizing of a lead, of one kind or of either. */
export const LatestSizingInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    kind: SizingKindSchema.optional(),
  })
  .strict();
export type LatestSizingInput = z.infer<typeof LatestSizingInput>;
