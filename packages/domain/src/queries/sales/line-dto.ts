import type { QuoteLineDto } from '@shakti/contracts';
import type { schema } from '@shakti/db';

type LineRow = typeof schema.quoteLines.$inferSelect | typeof schema.salesOrderLines.$inferSelect;

/** A stored quote or order line as the reads and the order copy carry it (`QuoteLineDto`). */
export function toLineDto(line: LineRow): QuoteLineDto {
  return {
    position: line.position,
    itemId: line.itemId,
    kitId: line.kitId,
    description: line.description,
    sku: line.sku,
    unit: line.unit as QuoteLineDto['unit'],
    qty: line.qty,
    unitPrice: line.unitPrice,
    hsn: line.hsn,
    worksContract: line.worksContract,
    taxRateId: line.taxRateId,
    taxRatePct: line.taxRatePct,
    compositeRuleId: line.compositeRuleId,
    goodsRatePct: line.goodsRatePct,
    servicesRatePct: line.servicesRatePct,
    taxableValue: line.taxableValue,
    goodsTaxable: line.goodsTaxable,
    servicesTaxable: line.servicesTaxable,
    cgst: line.cgst,
    sgst: line.sgst,
    igst: line.igst,
    lineTotal: line.lineTotal,
  };
}
