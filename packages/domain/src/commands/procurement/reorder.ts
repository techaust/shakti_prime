import {
  DomainError,
  DraftReorderInput,
  newId,
  RemoveReorderRuleInput,
  ReorderDraftDto,
  ReorderRuleDto,
  SetReorderRuleInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { toScaled } from '../../money/paise';
import { nextDocumentNo } from '../../numbering/next-document-no';
import { ORDER_CONSTRAINT_REASONS, deliveryHub, lineTaxRates } from './po-shared';

/**
 * Reorder rules and the reorder job (docs/03-roadmap-appendix/phase3.md §7.2): a rule per company,
 * item and hub, set with `procurement.po.write`; the platform's job (`procurement.reorder.draft`,
 * platform-only, ADR 0020) reads the rules below their level through `app.reorder_shortfalls()` and
 * drafts one purchase order per company, preferred vendor and hub, with quantities and GST rates
 * and no rate, through `app.reorder_draft_po()`. The Inventory Manager is told by the worker on
 * `procurement.po.drafted` and fills the rates under their own `procurement.rate.read`.
 */

const RULE_AUDIT_FIELDS = ['reorderLevel', 'reorderQty'] as const;

/** Three decimals, as the database keeps a quantity. */
function qty3(value: string): string {
  const scaled = toScaled(value, 3).toString().padStart(4, '0');
  return `${scaled.slice(0, -3)}.${scaled.slice(-3)}`;
}

/** `procurement.reorder_rule.set`: makes or changes the rule of a company, item and hub. */
export const setReorderRule = defineCommand({
  name: 'procurement.reorder_rule.set',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: SetReorderRuleInput,
  output: ReorderRuleDto,
  auditFields: RULE_AUDIT_FIELDS,
  constraintReasons: { reorder_rules_entity_item_hub_unique: 'reorder_rule_exists' },
  async handler(ctx, input) {
    if (!ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'entity outside the request scope', {
        entityId: input.entityId,
      });
    }
    await deliveryHub(ctx, input.warehouseId);
    const i = schema.items;
    const [item] = await ctx.tx
      .select({ isActive: i.isActive, archivedAt: i.archivedAt, isStocked: i.isStocked, tracked: i.isSerialTracked })
      .from(i)
      .where(eq(i.id, input.itemId))
      .limit(1);
    if (!item || !item.isActive || item.archivedAt !== null || !item.isStocked) {
      throw new DomainError('validation_failed', `item ${input.itemId} is not stocked`, {
        reason: 'purchase_order_item_unusable',
        itemId: input.itemId,
      });
    }
    const level = qty3(input.reorderLevel);
    const reorderQty = qty3(input.reorderQty);
    if (item.tracked && (!level.endsWith('.000') || !reorderQty.endsWith('.000'))) {
      throw new DomainError('validation_failed', 'a serial-tracked item is counted in whole units', {
        reason: 'reorder_rule_whole_units',
      });
    }
    const r = schema.reorderRules;
    const [existing] = await ctx.tx
      .select()
      .from(r)
      .where(
        and(eq(r.entityId, input.entityId), eq(r.itemId, input.itemId), eq(r.warehouseId, input.warehouseId)),
      )
      .limit(1)
      .for('update');
    let id: string;
    if (existing) {
      id = existing.id;
      await ctx.tx
        .update(r)
        .set({ reorderLevel: level, reorderQty, updatedBy: ctx.principal.id })
        .where(eq(r.id, id));
    } else {
      id = newId();
      await ctx.tx.insert(r).values({
        id,
        entityId: input.entityId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        reorderLevel: level,
        reorderQty,
        createdBy: ctx.principal.id,
      });
    }
    ctx.audit({
      aggregateType: 'reorder_rule',
      aggregateId: id,
      entityId: input.entityId,
      before: existing
        ? { reorderLevel: Number(existing.reorderLevel), reorderQty: Number(existing.reorderQty) }
        : null,
      after: {
        reorderLevel: Number(level),
        reorderQty: Number(reorderQty),
        itemId: input.itemId,
        warehouseId: input.warehouseId,
      },
    });
    return {
      id,
      entityId: input.entityId,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      reorderLevel: level,
      reorderQty,
    };
  },
});

/** `procurement.reorder_rule.remove`: the rule goes; nothing is drafted for it after. */
export const removeReorderRule = defineCommand({
  name: 'procurement.reorder_rule.remove',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: RemoveReorderRuleInput,
  output: ReorderRuleDto,
  auditFields: RULE_AUDIT_FIELDS,
  async handler(ctx, input) {
    const r = schema.reorderRules;
    const [rule] = await ctx.tx.delete(r).where(eq(r.id, input.ruleId)).returning();
    if (!rule || !ctx.entityIds.includes(rule.entityId)) {
      throw new DomainError('not_found', `reorder rule ${input.ruleId} is not readable`, {
        reason: 'reorder_rule_missing',
      });
    }
    ctx.audit({
      aggregateType: 'reorder_rule',
      aggregateId: rule.id,
      entityId: rule.entityId,
      before: { reorderLevel: Number(rule.reorderLevel), reorderQty: Number(rule.reorderQty) },
      after: null,
    });
    return {
      id: rule.id,
      entityId: rule.entityId,
      itemId: rule.itemId,
      warehouseId: rule.warehouseId,
      reorderLevel: rule.reorderLevel,
      reorderQty: rule.reorderQty,
    };
  },
});

interface Shortfall {
  item_id: string;
  warehouse_id: string;
  vendor_id: string | null;
  qty: string;
  hsn: string;
}

async function companyCode(ctx: CommandContext, entityId: number): Promise<string> {
  const [row] = await ctx.tx
    .select({ code: schema.entities.code })
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId))
    .limit(1);
  if (!row) throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  return row.code;
}

/**
 * `procurement.reorder.draft` (platform-only): for one company, every reorder rule below its level
 * with what is free and on order, grouped by preferred vendor and hub into one draft purchase order
 * each, with no rate. Items with no preferred active vendor are counted, not drafted. Run daily
 * and on each stock issue; the definers' company lock makes two runs at once draft once.
 */
export const draftReorders = defineCommand({
  name: 'procurement.reorder.draft',
  permission: 'procurement.reorder.draft',
  minScope: 'all',
  input: DraftReorderInput,
  output: ReorderDraftDto,
  auditFields: ['poNo', 'state', 'lineCount'],
  auditWhen: 'changed',
  constraintReasons: ORDER_CONSTRAINT_REASONS,
  async handler(ctx, input) {
    if (!ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'entity outside the request scope', {
        entityId: input.entityId,
      });
    }
    const shortfalls = (await ctx.tx.execute(
      sql`select item_id, warehouse_id, vendor_id, qty::text as qty, hsn
            from app.reorder_shortfalls(${input.entityId}::smallint)`,
    )) as unknown as Shortfall[];
    const groups = new Map<string, Shortfall[]>();
    let itemsWithoutVendor = 0;
    for (const row of shortfalls) {
      if (row.vendor_id === null) {
        itemsWithoutVendor += 1;
        continue;
      }
      const key = `${row.vendor_id}|${row.warehouse_id}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const purchaseOrderIds: string[] = [];
    if (groups.size === 0) return { entityId: input.entityId, purchaseOrderIds, itemsWithoutVendor };

    const code = await companyCode(ctx, input.entityId);
    const taxes = await lineTaxRates(
      ctx,
      shortfalls.map((s) => ({ id: s.item_id, hsn: s.hsn })),
    );
    for (const rows of groups.values()) {
      const first = rows[0];
      if (first === undefined || first.vendor_id === null) continue;
      const id = newId();
      const number = await nextDocumentNo(ctx, input.entityId, code, 'purchase_order');
      const lines = rows.slice(0, 200).map((row) => {
        const tax = taxes.get(row.item_id) ?? null;
        return {
          item_id: row.item_id,
          qty: row.qty,
          tax_rate_id: tax?.id ?? null,
          tax_rate_pct: tax?.ratePct ?? null,
        };
      });
      await ctx.tx.execute(
        sql`select app.reorder_draft_po(${input.entityId}::smallint, ${id}::uuid, ${number.formatted},
                                        ${first.vendor_id}::uuid, ${first.warehouse_id}::uuid,
                                        ${JSON.stringify(lines)}::jsonb)`,
      );
      purchaseOrderIds.push(id);
      ctx.audit({
        aggregateType: 'purchase_order',
        aggregateId: id,
        entityId: input.entityId,
        before: null,
        after: {
          poNo: number.formatted,
          state: 'draft',
          lineCount: lines.length,
          vendorId: first.vendor_id,
          deliverToWarehouseId: first.warehouse_id,
        },
      });
      ctx.emit({
        type: 'procurement.po.drafted',
        entityId: input.entityId,
        aggregateType: 'purchase_order',
        aggregateId: id,
        payload: { source: 'reorder', vendorId: first.vendor_id, lineCount: lines.length },
      });
    }
    return { entityId: input.entityId, purchaseOrderIds, itemsWithoutVendor };
  },
});
