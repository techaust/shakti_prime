import type { RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';

// U1: the vendors import's own database steps, run by the commit and the rollback of a vendor
// list through their definers (0236). Kept apart from the rows' commit, which runs the vendor
// commands, so a command that only calls these emits nothing of theirs.

/**
 * Undoes the vendors a job added (review M4): the ones nothing refers to yet are removed, the rest
 * archived (`app.import_vendors_undo()`). Answers how many of each.
 */
export async function undoVendorRows(
  tx: RequestTx,
  entityId: number,
  jobId: string,
  ids: readonly string[],
): Promise<{ removed: number; archived: number }> {
  if (ids.length === 0) return { removed: 0, archived: 0 };
  const [row] = (await tx.execute(sql`
    select removed, archived from app.import_vendors_undo(
      ${entityId}::smallint, ${jobId}::uuid,
      array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::uuid[])`)) as unknown as {
    removed: number;
    archived: number;
  }[];
  return { removed: row?.removed ?? 0, archived: row?.archived ?? 0 };
}

/**
 * Keeps only the mapped columns of a vendor list's rows (review L9), when the person commits it:
 * the sheet's other cells, a supplier's rates among them, are not kept.
 */
export async function keepMappedCells(
  tx: RequestTx,
  entityId: number,
  jobId: string,
  columns: readonly string[],
): Promise<void> {
  await tx.execute(sql`
    select app.import_rows_keep_columns(${entityId}::smallint, ${jobId}::uuid,
      array(select jsonb_array_elements_text(${JSON.stringify(columns)}::jsonb)))`);
}
