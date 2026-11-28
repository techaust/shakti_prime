import { CostLineDto } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { asc, eq, inArray } from 'drizzle-orm';

/**
 * The readers of a project's cost lines (J6, docs/03-roadmap-appendix/phase4.md §7.3, PRD PRJ-05).
 * Called only after the caller's `finance.cost.read` is checked, and row security narrows the rows
 * to that grant again; every line leaves only through the strict `CostLineDto`.
 */

type CostLineRow = typeof schema.projectCostLines.$inferSelect;

/** The lines as their DTOs, with each contractor's name and the reversal of each line. */
export async function toCostLineDtos(
  tx: RequestTx,
  rows: readonly CostLineRow[],
  reversedBy: ReadonlyMap<string, string>,
): Promise<CostLineDto[]> {
  const vendorIds = [...new Set(rows.flatMap((r) => (r.vendorId === null ? [] : [r.vendorId])))];
  // The contractor's name is read by the vendor master's own rule; a reader without it sees none.
  const vendors =
    vendorIds.length === 0
      ? []
      : await tx
          .select({ id: schema.vendors.id, name: schema.vendors.name })
          .from(schema.vendors)
          .where(inArray(schema.vendors.id, vendorIds));
  const names = new Map(vendors.map((v) => [v.id, v.name]));
  return rows.map((r) =>
    CostLineDto.parse({
      id: r.id,
      entityId: r.entityId,
      projectId: r.projectId,
      kind: r.kind,
      vendorId: r.vendorId,
      vendorName: r.vendorId === null ? null : (names.get(r.vendorId) ?? null),
      quantity: r.quantity,
      rate: r.rate,
      amount: r.amount,
      note: r.note,
      reversesId: r.reversesId,
      reversedById: reversedBy.get(r.id) ?? null,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
    }),
  );
}

/** A project's lines in the order they were added (`project_cost_lines_project_idx`). */
export async function readProjectCostLines(
  tx: RequestTx,
  projectId: string,
): Promise<CostLineRow[]> {
  const l = schema.projectCostLines;
  return tx
    .select()
    .from(l)
    .where(eq(l.projectId, projectId))
    .orderBy(asc(l.createdAt), asc(l.id))
    .limit(1000);
}

/** Which line reversed which, among the given lines. */
export function reversalsOf(rows: readonly CostLineRow[]): Map<string, string> {
  return new Map(
    rows.flatMap((r) => (r.reversesId === null ? [] : [[r.reversesId, r.id] as const])),
  );
}
