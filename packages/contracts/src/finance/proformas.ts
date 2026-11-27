import { z } from 'zod';
import { QuoteLineDto, QuoteTotalsDto } from '../dto/quote';
import { EntityIdSchema, IdSchema } from '../ids';
import { StateCodeSchema, SupplyKindSchema } from '../tax/engine';

/**
 * Proformas (docs/03-roadmap-appendix/phase5.md §5, §6.1, question 3 (a)): the one document the
 * BOS issues to ask for payment. A proforma copies its confirmed order's lines, prices, HSN codes,
 * tax rates and tax split exactly as the order holds them, and is numbered from the company's
 * `proforma` series (`<company>/PI/<financial year>/<number>`). A cancelled proforma keeps its
 * number. Tax invoices, receipts and credit notes stay in Tally.
 */

/** The `proforma` machine's states (`proformas.state`). */
export const PROFORMA_STATES = ['issued', 'cancelled'] as const;
export const ProformaStateSchema = z.enum(PROFORMA_STATES);
export type ProformaState = z.infer<typeof ProformaStateSchema>;

/** `finance.proforma.issue`: a proforma of a confirmed order. */
export const IssueProformaInput = z
  .object({ entityId: EntityIdSchema, orderId: IdSchema })
  .strict();
export type IssueProformaInput = z.input<typeof IssueProformaInput>;

export const PROFORMA_CANCEL_REASON_MAX = 300;

/** `finance.proforma.cancel`: a proforma withdrawn, and why; its number stays used. */
export const CancelProformaInput = z
  .object({
    entityId: EntityIdSchema,
    proformaId: IdSchema,
    reason: z.string().trim().min(1).max(PROFORMA_CANCEL_REASON_MAX),
  })
  .strict();
export type CancelProformaInput = z.input<typeof CancelProformaInput>;

/** One proforma with its lines, as the Payments tab and the print show it. */
export const ProformaDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    proformaNo: z.string(),
    orderId: IdSchema,
    soNo: z.string(),
    state: ProformaStateSchema,
    placeOfSupplyState: StateCodeSchema,
    supplyKind: SupplyKindSchema,
    lines: z.array(QuoteLineDto),
    totals: QuoteTotalsDto,
    issuedAt: z.iso.datetime(),
    issuedByName: z.string().nullable(),
    pdfFileId: IdSchema.nullable(),
    cancelledAt: z.iso.datetime().nullable(),
    cancelledByName: z.string().nullable(),
    cancelReason: z.string().nullable(),
  })
  .strict();
export type ProformaDto = z.infer<typeof ProformaDto>;
