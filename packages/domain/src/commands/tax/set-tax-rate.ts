import { DomainError, newId, SetTaxRateInput, TaxRateRowSchema } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertTaxGroupScope } from './group-scope';

/**
 * `tax.rate.set` (design §6, SAL-02): the one way a GST rate is recorded. The rate of an HSN code
 * or an item that was open-ended ends where the new one starts; any other overlap is refused by
 * the table's exclusion constraints, which answer `tax_rate_overlap`. Rates are shared by every
 * company, so the audit rows belong to no one company, and only a request acting for every company
 * may record one (`tax_group_scope`). Quotes keep the rate they were made with.
 */
export const setTaxRate = defineCommand({
  name: 'tax.rate.set',
  permission: 'tax.rates.write',
  minScope: 'entity',
  input: SetTaxRateInput,
  output: TaxRateRowSchema,
  auditFields: ['hsn', 'ratePct', 'effectiveFrom', 'effectiveTo', 'sourceRef'],
  constraintReasons: {
    tax_rates_hsn_period_excl: 'tax_rate_overlap',
    tax_rates_item_period_excl: 'tax_rate_overlap',
  },
  async handler(ctx, input) {
    await assertTaxGroupScope(ctx);
    if (input.itemId !== undefined) {
      const [item] = await ctx.tx
        .select({ id: schema.items.id })
        .from(schema.items)
        .where(and(eq(schema.items.id, input.itemId), isNull(schema.items.archivedAt)))
        .limit(1);
      if (!item) {
        throw new DomainError('validation_failed', `item ${input.itemId} is not available`, {
          reason: 'tax_item_missing',
        });
      }
    }

    const tr = schema.taxRates;
    const target =
      input.hsn !== undefined ? eq(tr.hsn, input.hsn) : eq(tr.itemId, input.itemId ?? '');
    const actor = ctx.principal.id;
    const [open] = await ctx.tx
      .select({ id: tr.id })
      .from(tr)
      .where(and(target, isNull(tr.effectiveTo), lt(tr.effectiveFrom, input.effectiveFrom)))
      .limit(1)
      // a concurrent change of the same code waits here and then finds nothing open
      .for('update');
    if (open) {
      await ctx.tx
        .update(tr)
        .set({ effectiveTo: input.effectiveFrom, updatedBy: actor })
        .where(eq(tr.id, open.id));
      ctx.audit({
        aggregateType: 'tax_rate',
        aggregateId: open.id,
        entityId: null,
        before: { effectiveTo: null },
        after: { effectiveTo: input.effectiveFrom },
      });
    }

    const [row] = await ctx.tx
      .insert(tr)
      .values({
        id: newId(),
        hsn: input.hsn ?? null,
        itemId: input.itemId ?? null,
        ratePct: input.ratePct,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        sourceRef: input.sourceRef ?? null,
        createdBy: actor,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'tax rate insert returned no row');

    const dto = TaxRateRowSchema.parse({
      id: row.id,
      hsn: row.hsn,
      itemId: row.itemId,
      ratePct: row.ratePct,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    });
    ctx.audit({
      aggregateType: 'tax_rate',
      aggregateId: row.id,
      entityId: null,
      before: null,
      after: { ...dto, sourceRef: row.sourceRef, closedRateId: open?.id ?? null },
    });
    return dto;
  },
});
