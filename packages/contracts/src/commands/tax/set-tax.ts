import { z } from 'zod';
import { HsnSchema } from '../../catalogue/enums';
import { SegmentSchema } from '../../crm/enums';
import { IdSchema } from '../../ids';
import { PercentSchema } from '../../tax/engine';

/** A real calendar date, `YYYY-MM-DD`, read in IST like every document date. */
const EffectiveDate = z.iso.date();

const endsAfterStart = (v: { effectiveFrom: string; effectiveTo?: string | undefined }) =>
  v.effectiveTo === undefined || v.effectiveTo > v.effectiveFrom;

/**
 * `tax.rate.set` (design §6, SAL-02): Accounts sets the GST rate of an HSN code or of one item
 * from a date. The rate that was open-ended until then ends where the new one starts; a period
 * that overlaps another rate of the same code or item is refused.
 */
export const SetTaxRateInput = z
  .object({
    hsn: HsnSchema.optional(),
    itemId: IdSchema.optional(),
    ratePct: PercentSchema,
    effectiveFrom: EffectiveDate,
    effectiveTo: EffectiveDate.optional(),
    /** The notification or circular the rate comes from. */
    sourceRef: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .refine((v) => (v.hsn === undefined) !== (v.itemId === undefined), {
    message: 'exactly one of hsn or itemId',
    path: ['hsn'],
  })
  .refine(endsAfterStart, {
    message: 'the end date must be after the start',
    path: ['effectiveTo'],
  });
export type SetTaxRateInput = z.infer<typeof SetTaxRateInput>;

/**
 * `tax.composite.set` (design §6, ADR 0007): Accounts sets the goods and services split of a
 * composite supply for a segment from a date (solar 70:30). The shares add up to 100.
 */
export const SetCompositeRuleInput = z
  .object({
    segment: SegmentSchema,
    goodsSharePct: PercentSchema,
    servicesSharePct: PercentSchema,
    goodsRatePct: PercentSchema,
    servicesRatePct: PercentSchema,
    effectiveFrom: EffectiveDate,
    effectiveTo: EffectiveDate.optional(),
  })
  .strict()
  .refine(
    (v) =>
      Math.round(Number(v.goodsSharePct) * 100) + Math.round(Number(v.servicesSharePct) * 100) ===
      10_000,
    { message: 'the goods and services shares add up to 100', path: ['servicesSharePct'] },
  )
  .refine(endsAfterStart, {
    message: 'the end date must be after the start',
    path: ['effectiveTo'],
  });
export type SetCompositeRuleInput = z.infer<typeof SetCompositeRuleInput>;
