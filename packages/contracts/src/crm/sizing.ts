import { z } from 'zod';

/**
 * Sizing enumerations (docs/design/phase1.md §6.7, BLUEPRINT §8.3, PRD SAL-04). The calculators in
 * `@shakti/domain` return these codes; the quote guard refuses on them and the sizing panel names
 * each in plain words (`sizing.reason.*` in the message catalogue).
 */
export const SizingKindSchema = z.enum(['pump', 'rooftop']);
export type SizingKind = z.infer<typeof SizingKindSchema>;

/** Where the pump sits: in the borewell (submersible) or at the surface (monoblock). */
export const PumpTypeSchema = z.enum(['submersible', 'surface']);
export type PumpType = z.infer<typeof PumpTypeSchema>;

/** What drives the pump: the grid or a solar array. */
export const PumpDriveSchema = z.enum(['grid', 'solar']);
export type PumpDrive = z.infer<typeof PumpDriveSchema>;

/** The pipe material, which sets the Hazen-Williams roughness coefficient. */
export const PipeMaterialSchema = z.enum(['hdpe', 'gi']);
export type PipeMaterial = z.infer<typeof PipeMaterialSchema>;

/** The subsidy scheme a system is sold under; the DCR rule depends on it. */
export const SubsidySchemeSchema = z.enum(['none', 'pm_surya_ghar', 'pm_kusum']);
export type SubsidyScheme = z.infer<typeof SubsidySchemeSchema>;

/** The limit that set a rooftop system's size. */
export const RooftopBoundSchema = z.enum(['need', 'roof', 'sanctioned_load']);
export type RooftopBound = z.infer<typeof RooftopBoundSchema>;

/**
 * Why a sizing, a duty point or a rule is out of bounds. A code, never a sentence, so the quote
 * guard can refuse on it and reports can count it.
 */
export const SizingReasonSchema = z.enum([
  // The pump curve (pumpDutyPoint).
  'curve_too_short',
  'curve_not_monotonic',
  'head_above_curve',
  'head_below_curve',
  // Pump power (pumpPower).
  'above_largest_standard_hp',
  // Rooftop size (rooftopSize).
  'no_consumption',
  'roof_too_small',
  'sanctioned_load_too_small',
  // The rules checked when a quote is made.
  'sanctioned_load_exceeded',
  'dcr_modules_required',
  'no_modules',
]);
export type SizingReason = z.infer<typeof SizingReasonSchema>;
