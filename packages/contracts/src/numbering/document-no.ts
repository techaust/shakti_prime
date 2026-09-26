import { z } from 'zod';

/** Documents numbered from `document_sequences` per entity and financial year (ADR 0006). */
export const DocTypeSchema = z.enum([
  'quote',
  'sales_order',
  'proforma',
  'challan',
  'purchase_order',
]);
export type DocType = z.infer<typeof DocTypeSchema>;

/** Indian financial year, April to March, written `2026-27`. */
export const FinancialYearSchema = z.string().regex(/^\d{4}-\d{2}$/);
export type FinancialYear = z.infer<typeof FinancialYearSchema>;

export const DocumentNoSchema = z
  .object({
    docType: DocTypeSchema,
    fy: FinancialYearSchema,
    no: z.number().int().positive(),
    formatted: z.string().min(1),
  })
  .strict();
export type DocumentNo = z.infer<typeof DocumentNoSchema>;
