import {
  DomainError,
  ItemVendorSetDto,
  newId,
  SetItemVendorInput,
  SetVendorContactsInput,
  VendorContactsDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readContacts, readItemLinks } from '../../queries/procurement/vendor-read';
import { eventEntity } from '../catalogue/shared';
import { lockVendor } from './vendors';

/**
 * `procurement.vendor.contact.set`: a vendor's people as a set, in the order sent. The audit row
 * names the people and their roles only, never a phone number or an email.
 */
export const setVendorContacts = defineCommand({
  name: 'procurement.vendor.contact.set',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: SetVendorContactsInput,
  output: VendorContactsDto,
  auditFields: ['vendorContacts'],
  async handler(ctx, input) {
    // The vendor row is the set's lock: two saves of the same sheet run one after the other.
    await lockVendor(ctx, input.vendorId);
    const before = await readContacts(ctx.tx, input.vendorId);
    await ctx.tx
      .delete(schema.vendorContacts)
      .where(eq(schema.vendorContacts.vendorId, input.vendorId));
    if (input.contacts.length > 0) {
      await ctx.tx.insert(schema.vendorContacts).values(
        input.contacts.map((c, index) => ({
          id: newId(),
          vendorId: input.vendorId,
          name: c.name,
          role: c.role ?? null,
          phoneE164: c.phone ?? null,
          email: c.email ?? null,
          position: index + 1,
          createdBy: ctx.principal.id,
        })),
      );
    }
    const after = await readContacts(ctx.tx, input.vendorId);
    const named = (list: typeof after) =>
      list.map((c) => (c.role === null ? c.name : `${c.name} (${c.role})`));
    ctx.audit({
      aggregateType: 'vendor',
      aggregateId: input.vendorId,
      entityId: null,
      before: { vendorContacts: named(before) },
      after: { vendorContacts: named(after) },
    });
    ctx.emit({
      type: 'procurement.vendor.updated',
      entityId: eventEntity(ctx),
      aggregateType: 'vendor',
      aggregateId: input.vendorId,
      payload: { part: 'contacts' },
    });
    return { vendorId: input.vendorId, contacts: after };
  },
});

/**
 * `procurement.item_vendor.set`: whether an active vendor supplies an item still in the catalogue,
 * the vendor's own code for it and whether it is the item's preferred vendor. Marking one vendor
 * preferred takes the mark from the item's other preferred vendor in the same change.
 */
export const setItemVendor = defineCommand({
  name: 'procurement.item_vendor.set',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: SetItemVendorInput,
  output: ItemVendorSetDto,
  auditFields: ['itemSupplied', 'vendorItemCode', 'preferredVendor'],
  // Two people marking different vendors preferred for one item at once: one of them is refused.
  constraintReasons: {
    item_vendors_one_preferred: 'item_vendor_changed',
    item_vendors_item_vendor_unique: 'item_vendor_changed',
  },
  async handler(ctx, input) {
    await lockVendor(ctx, input.vendorId);
    const [item] = await ctx.tx
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(and(eq(schema.items.id, input.itemId), isNull(schema.items.archivedAt)))
      .limit(1);
    if (!item && input.supplies) {
      throw new DomainError('not_found', `item ${input.itemId} is not in the catalogue`, {
        reason: 'catalogue_item_missing',
      });
    }
    const iv = schema.itemVendors;
    const [existing] = await ctx.tx
      .select()
      .from(iv)
      .where(and(eq(iv.vendorId, input.vendorId), eq(iv.itemId, input.itemId)))
      .limit(1);
    const audited = (row: typeof existing) =>
      row === undefined
        ? { itemSupplied: false, vendorItemCode: null, preferredVendor: false }
        : {
            itemSupplied: true,
            vendorItemCode: row.vendorItemCode,
            preferredVendor: row.isPreferred,
          };

    if (input.isPreferred) {
      const taken = await ctx.tx
        .update(iv)
        .set({ isPreferred: false, updatedBy: ctx.principal.id })
        .where(
          and(
            eq(iv.itemId, input.itemId),
            eq(iv.isPreferred, true),
            ne(iv.vendorId, input.vendorId),
          ),
        )
        .returning();
      for (const other of taken) {
        ctx.audit({
          aggregateType: 'item_vendor',
          aggregateId: other.id,
          entityId: null,
          before: { vendorId: other.vendorId, itemId: other.itemId, preferredVendor: true },
          after: { vendorId: other.vendorId, itemId: other.itemId, preferredVendor: false },
        });
      }
    }

    let linkId: string | undefined;
    if (!input.supplies) {
      if (existing) await ctx.tx.delete(iv).where(eq(iv.id, existing.id));
    } else if (existing) {
      await ctx.tx
        .update(iv)
        .set({
          vendorItemCode: input.vendorItemCode ?? null,
          isPreferred: input.isPreferred,
          updatedBy: ctx.principal.id,
        })
        .where(eq(iv.id, existing.id));
      linkId = existing.id;
    } else {
      linkId = newId();
      await ctx.tx.insert(iv).values({
        id: linkId,
        itemId: input.itemId,
        vendorId: input.vendorId,
        vendorItemCode: input.vendorItemCode ?? null,
        isPreferred: input.isPreferred,
        createdBy: ctx.principal.id,
      });
    }

    const [link] = await readItemLinks(ctx.tx, input.vendorId, input.itemId);
    ctx.audit({
      aggregateType: 'item_vendor',
      aggregateId: linkId ?? existing?.id ?? input.itemId,
      entityId: null,
      before: { vendorId: input.vendorId, itemId: input.itemId, ...audited(existing) },
      after: {
        vendorId: input.vendorId,
        itemId: input.itemId,
        ...(link === undefined
          ? audited(undefined)
          : {
              itemSupplied: true,
              vendorItemCode: link.vendorItemCode,
              preferredVendor: link.isPreferred,
            }),
      },
    });
    ctx.emit({
      type: 'procurement.vendor.updated',
      entityId: eventEntity(ctx),
      aggregateType: 'vendor',
      aggregateId: input.vendorId,
      payload: { part: 'items', itemId: input.itemId },
    });
    return { vendorId: input.vendorId, itemId: input.itemId, link: link ?? null };
  },
});
