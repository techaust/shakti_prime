import { DomainError, newId, PriceListItemDto, SetPriceInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { istCalendarDate } from '../../numbering/financial-year';

/**
 * `pricing.price.set`: the one way a price changes (SAL-01). Sets the price of an item or kit on a
 * price list the caller can see. The database appends the change to `price_change_log` from the
 * write itself (AUDIT M18), with the reason this command passes in `app.price_reason`. Scheduled
 * changes are a new price-list version, not an edit here.
 */
export const setPrice = defineCommand({
  name: 'pricing.price.set',
  permission: 'pricing.write',
  minScope: 'entity',
  input: SetPriceInput,
  output: PriceListItemDto,
  auditFields: ['price', 'reason'],
  async handler(ctx, input) {
    const pl = schema.priceLists;
    const [list] = await ctx.tx
      .select({
        id: pl.id,
        entityId: pl.entityId,
        effectiveTo: pl.effectiveTo,
        archivedAt: pl.archivedAt,
        tierCode: schema.priceTiers.code,
      })
      .from(pl)
      .innerJoin(schema.priceTiers, eq(schema.priceTiers.id, pl.tierId))
      .where(eq(pl.id, input.priceListId))
      .limit(1);
    if (!list) {
      throw new DomainError('not_found', `price list ${input.priceListId} is not visible`, {
        reason: 'price_list_missing',
      });
    }
    if (
      list.archivedAt !== null ||
      // effective_to is exclusive: a list ending today no longer prices anything (AUDIT M19)
      (list.effectiveTo !== null && list.effectiveTo <= istCalendarDate(ctx.now))
    ) {
      throw new DomainError('conflict', 'price list is closed', { reason: 'price_list_closed' });
    }
    // A shared list prices every company, so only a request acting for every company may change
    // it (AUDIT H2); the database policy enforces the same rule.
    if (list.entityId === null) {
      const covered = (await ctx.tx.execute(
        sql`select app.request_covers_group() as ok`,
      )) as unknown as { ok: boolean }[];
      if (covered[0]?.ok !== true) {
        throw new DomainError('forbidden', 'a shared price list needs every company in scope', {
          reason: 'price_list_group_scope',
        });
      }
    }
    const eventEntityId = list.entityId ?? ctx.entityIds[0];
    if (eventEntityId === undefined) {
      throw new DomainError('forbidden', 'no entity in the request scope');
    }

    if (input.itemId !== undefined) {
      const [item] = await ctx.tx
        .select({ id: schema.items.id })
        .from(schema.items)
        .where(
          and(
            eq(schema.items.id, input.itemId),
            eq(schema.items.isActive, true),
            isNull(schema.items.archivedAt),
          ),
        )
        .limit(1);
      if (!item) {
        throw new DomainError('validation_failed', 'item is not active', {
          reason: 'price_item_missing',
        });
      }
    } else if (input.kitId !== undefined) {
      const [kit] = await ctx.tx
        .select({ id: schema.kits.id })
        .from(schema.kits)
        .where(
          and(
            eq(schema.kits.id, input.kitId),
            eq(schema.kits.isActive, true),
            isNull(schema.kits.archivedAt),
          ),
        )
        .limit(1);
      if (!kit) {
        throw new DomainError('validation_failed', 'kit is not active', {
          reason: 'price_item_missing',
        });
      }
    }

    const pli = schema.priceListItems;
    const target =
      input.itemId !== undefined ? eq(pli.itemId, input.itemId) : eq(pli.kitId, input.kitId ?? '');
    const [existing] = await ctx.tx
      .select({ id: pli.id, price: pli.price })
      .from(pli)
      .where(and(eq(pli.priceListId, list.id), target))
      .limit(1)
      // a concurrent change of the same price waits here, so the old price below is the latest
      .for('update');

    await ctx.tx.execute(sql`select set_config('app.price_reason', ${input.reason ?? ''}, true)`);

    const actor = ctx.principal.id;
    const [row] = existing
      ? await ctx.tx
          .update(pli)
          .set({ price: input.price, updatedBy: actor })
          .where(eq(pli.id, existing.id))
          .returning()
      : await ctx.tx
          .insert(pli)
          .values({
            id: newId(),
            priceListId: list.id,
            itemId: input.itemId ?? null,
            kitId: input.kitId ?? null,
            price: input.price,
            createdBy: actor,
          })
          .returning();
    if (!row) throw new DomainError('internal', 'price list item write returned no row');

    ctx.audit({
      aggregateType: 'price_list_item',
      aggregateId: row.id,
      entityId: list.entityId,
      before: existing === undefined ? null : { price: existing.price },
      after: {
        priceListId: list.id,
        itemId: row.itemId,
        kitId: row.kitId,
        price: row.price,
        reason: input.reason ?? null,
      },
    });
    ctx.emit({
      type: 'pricing.price.changed',
      entityId: eventEntityId,
      aggregateType: 'price_list_item',
      aggregateId: row.id,
      payload: {
        priceListId: list.id,
        itemId: row.itemId,
        kitId: row.kitId,
        oldPrice: existing?.price ?? null,
        newPrice: input.price,
      },
    });

    return {
      id: row.id,
      priceListId: row.priceListId,
      entityId: list.entityId,
      tierCode: list.tierCode,
      itemId: row.itemId,
      kitId: row.kitId,
      price: row.price,
      updatedAt: row.updatedAt.toISOString(),
    };
  },
});
