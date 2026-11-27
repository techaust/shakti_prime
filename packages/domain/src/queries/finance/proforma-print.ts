import {
  DomainError,
  HsnSchema,
  ItemUnitSchema,
  MilestoneDueRuleSchema,
  MoneySchema,
  PaymentMilestoneStateSchema,
  SignedMoneySchema,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

const percent = z
  .string()
  .regex(/^\d{1,3}\.\d{2}$/)
  .nullable();

/** What `app.proforma_for_print()` answers for one proforma (ADR 0009). */
const ProformaForPrintSchema = z
  .object({
    id: z.string(),
    entityId: z.number().int(),
    proformaNo: z.string(),
    state: z.enum(['issued', 'cancelled']),
    createdAt: z.string(),
    soNo: z.string(),
    placeOfSupplyState: z.string().regex(/^[0-9]{2}$/),
    supplyKind: z.enum(['intra', 'inter']),
    subtotal: MoneySchema,
    cgst: MoneySchema,
    sgst: MoneySchema,
    igst: MoneySchema,
    roundOff: SignedMoneySchema,
    grandTotal: MoneySchema,
    customerName: z.string(),
    customerGstin: z.string().nullable(),
    site: z
      .object({
        address: z.string().nullable(),
        village: z.string().nullable(),
        tehsil: z.string().nullable(),
        district: z.string().nullable(),
        pin: z.string().nullable(),
      })
      .strict()
      .nullable(),
    preparedBy: z.string().nullable(),
    lines: z
      .array(
        z
          .object({
            position: z.number().int().min(1),
            sku: z.string(),
            description: z.string(),
            unit: ItemUnitSchema,
            qty: z.string(),
            unitPrice: MoneySchema,
            hsn: HsnSchema.nullable(),
            taxRatePct: percent,
            goodsRatePct: percent,
            servicesRatePct: percent,
            taxableValue: MoneySchema,
            cgst: MoneySchema,
            sgst: MoneySchema,
            igst: MoneySchema,
          })
          .strict(),
      )
      .min(1),
    milestones: z.array(
      z
        .object({
          label: z.string(),
          amount: MoneySchema,
          dueRule: MilestoneDueRuleSchema,
          dueDays: z.number().int().nullable(),
          state: PaymentMilestoneStateSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type ProformaForPrint = z.infer<typeof ProformaForPrintSchema>;

/**
 * One proforma as the render worker prints it (ADR 0009, docs/03-roadmap-appendix/phase5.md
 * §6.1): read through `app.proforma_for_print()`, which only the worker principal
 * (`files.process`) may call and which answers the proforma as copied from its order, the
 * customer's name, GSTIN and the order's site, who issued it and the order's payments, never a
 * phone number. A proforma outside the request is `not_found`.
 */
export async function loadProformaForPrint(
  ctx: Pick<RequestContext, 'tx'>,
  proformaId: string,
): Promise<ProformaForPrint> {
  const rows = (await ctx.tx.execute(
    sql`select app.proforma_for_print(${proformaId}::uuid) as proforma`,
  )) as unknown as { proforma: unknown }[];
  const proforma = rows[0]?.proforma ?? null;
  if (proforma === null) {
    throw new DomainError('not_found', `proforma ${proformaId} is not visible to the printer`, {
      reason: 'proforma_missing',
    });
  }
  return ProformaForPrintSchema.parse(proforma);
}
