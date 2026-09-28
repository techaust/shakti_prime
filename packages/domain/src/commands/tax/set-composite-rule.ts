import {
  CompositeRuleRowSchema,
  DomainError,
  newId,
  SetCompositeRuleInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';

/**
 * `tax.composite.set` (design §6, ADR 0007): the goods and services split of a composite supply
 * for a segment from a date. The rule that was open-ended ends where the new one starts; any
 * other overlap is refused by the exclusion constraint, which answers `composite_rule_overlap`.
 * Rules are shared by every company, so the audit rows belong to no one company.
 */
export const setCompositeRule = defineCommand({
  name: 'tax.composite.set',
  permission: 'tax.rates.write',
  minScope: 'entity',
  input: SetCompositeRuleInput,
  output: CompositeRuleRowSchema,
  auditFields: ['segment', 'goodsSharePct', 'servicesSharePct', 'goodsRatePct', 'servicesRatePct', 'effectiveFrom', 'effectiveTo'],
  constraintReasons: {
    composite_supply_rules_period_excl: 'composite_rule_overlap',
    composite_supply_rules_share_check: 'composite_share_total',
  },
  async handler(ctx, input) {
    const cr = schema.compositeSupplyRules;
    const actor = ctx.principal.id;
    const [open] = await ctx.tx
      .select({ id: cr.id })
      .from(cr)
      .where(
        and(
          eq(cr.segment, input.segment),
          isNull(cr.effectiveTo),
          lt(cr.effectiveFrom, input.effectiveFrom),
        ),
      )
      .limit(1)
      // a concurrent change of the same segment waits here and then finds nothing open
      .for('update');
    if (open) {
      await ctx.tx
        .update(cr)
        .set({ effectiveTo: input.effectiveFrom, updatedBy: actor })
        .where(eq(cr.id, open.id));
      ctx.audit({
        aggregateType: 'composite_supply_rule',
        aggregateId: open.id,
        entityId: null,
        before: { effectiveTo: null },
        after: { effectiveTo: input.effectiveFrom },
      });
    }

    const [row] = await ctx.tx
      .insert(cr)
      .values({
        id: newId(),
        segment: input.segment,
        goodsSharePct: input.goodsSharePct,
        servicesSharePct: input.servicesSharePct,
        goodsRatePct: input.goodsRatePct,
        servicesRatePct: input.servicesRatePct,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        createdBy: actor,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'composite rule insert returned no row');

    const dto = CompositeRuleRowSchema.parse({
      id: row.id,
      segment: row.segment,
      goodsSharePct: row.goodsSharePct,
      servicesSharePct: row.servicesSharePct,
      goodsRatePct: row.goodsRatePct,
      servicesRatePct: row.servicesRatePct,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
    });
    ctx.audit({
      aggregateType: 'composite_supply_rule',
      aggregateId: row.id,
      entityId: null,
      before: null,
      after: { ...dto, closedRuleId: open?.id ?? null },
    });
    return dto;
  },
});
