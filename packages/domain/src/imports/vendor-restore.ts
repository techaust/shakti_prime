import { VendorAddressSchema, VendorContactInput } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { CommandContext } from '../command/context';
import { setVendorContacts } from '../commands/procurement/vendor-links';
import { updateVendor } from '../commands/procurement/vendors';

/**
 * What a rollback restores of a vendor a row updated (`import_rows.undo_json`, review M5): the
 * vendor as it was, its people when the row added one, and the time of the row's change, so a
 * vendor someone changed since is kept as it is.
 */
export const VendorUndo = z
  .object({
    before: z.object({
      name: z.string(),
      gstin: z.string().nullable(),
      pan: z.string().nullable(),
      address: VendorAddressSchema,
      paymentTermsDays: z.number().int().nullable(),
      leadTimeDays: z.number().int().nullable(),
      notes: z.string().nullable(),
    }),
    contacts: z.array(VendorContactInput).nullable(),
    changedAt: z.string(),
  })
  .strict();
export type VendorUndo = z.infer<typeof VendorUndo>;

/**
 * Restores the vendors a job's rows updated (review M5), each through the vendor commands: its
 * details as they were and, when the row added a person, its people as they were. A vendor changed
 * since the row's change, or archived, is kept as it is. Answers how many were restored and kept.
 */
export async function restoreVendorUpdates(
  ctx: CommandContext,
  tx: RequestTx,
  jobId: string,
): Promise<{ restored: number; kept: number }> {
  const r = schema.importRows;
  const rows = await tx
    .select({ createdId: r.createdId, undo: r.undoJson })
    .from(r)
    .where(and(eq(r.jobId, jobId), eq(r.state, 'committed'), eq(r.createdType, 'vendor_update')));
  let restored = 0;
  let kept = 0;
  const nested = { tx, auditedByCaller: true };
  for (const row of rows) {
    const parsed = VendorUndo.safeParse(row.undo);
    if (row.createdId === null || !parsed.success) {
      kept += 1;
      continue;
    }
    const undo = parsed.data;
    const [current] = await tx
      .select({ isActive: schema.vendors.isActive, updatedAt: schema.vendors.updatedAt })
      .from(schema.vendors)
      .where(eq(schema.vendors.id, row.createdId))
      .limit(1);
    if (!current?.isActive || current.updatedAt.toISOString() !== undo.changedAt) {
      kept += 1;
      continue;
    }
    const before = { vendorId: row.createdId, ...undo.before };
    await ctx.run(updateVendor, before, nested);
    if (undo.contacts !== null) {
      const people = { vendorId: row.createdId, contacts: undo.contacts };
      await ctx.run(setVendorContacts, people, nested);
    }
    restored += 1;
  }
  return { restored, kept };
}
