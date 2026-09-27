import { z } from 'zod';
import { HsnSchema, MoneySchema, SignedMoneySchema } from '../catalogue/enums';
import { SegmentSchema } from '../crm/enums';
import { IdSchema } from '../ids';

/**
 * Shapes that cross the tax engine's boundary (ADR 0007, docs/design/backend-weeks-3-5.md §6).
 * The engine works in integer paise inside; everything here is a decimal string, as the database
 * `numeric` columns and the API carry it.
 */

/** A percentage with two decimals, as `numeric(5,2)` returns it: `18.00`, `0.25`. */
export const PercentSchema = z
  .string()
  .regex(/^\d{1,3}\.\d{2}$/)
  .refine((value) => Number(value) <= 100, { message: 'percentage above 100' });
export type Percent = z.infer<typeof PercentSchema>;

/** A quantity as `numeric(12,3)` returns it: up to three decimals, above zero. */
export const QuantitySchema = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,3})?$/)
  .refine((value) => Number(value) > 0, { message: 'quantity must be above zero' });
export type Quantity = z.infer<typeof QuantitySchema>;

/** A calendar date as Postgres `date` returns it. */
export const CalendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export type CalendarDate = z.infer<typeof CalendarDateSchema>;

/** Two-digit GST state code (`27` Maharashtra, `24` Gujarat). */
export const StateCodeSchema = z.string().regex(/^[0-9]{2}$/);
export type StateCode = z.infer<typeof StateCodeSchema>;

/** One `tax_rates` row as a command loads it: either an HSN or an item, effective `[from, to)`. */
export const TaxRateRowSchema = z
  .object({
    id: IdSchema,
    hsn: HsnSchema.nullable(),
    itemId: IdSchema.nullable(),
    ratePct: PercentSchema,
    effectiveFrom: CalendarDateSchema,
    effectiveTo: CalendarDateSchema.nullable(),
  })
  .strict();
export type TaxRateRow = z.infer<typeof TaxRateRowSchema>;

/** One `composite_supply_rules` row: the goods and services shares and their rates. */
export const CompositeRuleRowSchema = z
  .object({
    id: IdSchema,
    segment: SegmentSchema,
    goodsSharePct: PercentSchema,
    servicesSharePct: PercentSchema,
    goodsRatePct: PercentSchema,
    servicesRatePct: PercentSchema,
    effectiveFrom: CalendarDateSchema,
    effectiveTo: CalendarDateSchema.nullable(),
  })
  .strict();
export type CompositeRuleRow = z.infer<typeof CompositeRuleRowSchema>;

export const SupplyKindSchema = z.enum(['intra', 'inter']);
export type SupplyKind = z.infer<typeof SupplyKindSchema>;

export const SupplySourceSchema = z.enum(['site', 'account_gstin', 'entity']);
export type SupplySource = z.infer<typeof SupplySourceSchema>;

export const PlaceOfSupplySchema = z
  .object({ stateCode: StateCodeSchema, kind: SupplyKindSchema, source: SupplySourceSchema })
  .strict();
export type PlaceOfSupply = z.infer<typeof PlaceOfSupplySchema>;

/** The tax snapshot of one document line (`quote_lines`, `sales_order_lines`). */
export const TaxedLineSchema = z
  .object({
    taxRateId: IdSchema.nullable(),
    compositeRuleId: IdSchema.nullable(),
    supplyKind: SupplyKindSchema,
    taxableValue: MoneySchema,
    goodsTaxable: MoneySchema.nullable(),
    servicesTaxable: MoneySchema.nullable(),
    cgst: MoneySchema,
    sgst: MoneySchema,
    igst: MoneySchema,
    lineTotal: MoneySchema,
  })
  .strict();
export type TaxedLine = z.infer<typeof TaxedLineSchema>;

/** The totals of a document: the subtotal, each tax head, the rupee round-off and the total. */
export const DocumentTotalsSchema = z
  .object({
    subtotal: MoneySchema,
    cgst: MoneySchema,
    sgst: MoneySchema,
    igst: MoneySchema,
    taxTotal: MoneySchema,
    roundOff: SignedMoneySchema,
    grandTotal: MoneySchema,
  })
  .strict();
export type DocumentTotals = z.infer<typeof DocumentTotalsSchema>;
