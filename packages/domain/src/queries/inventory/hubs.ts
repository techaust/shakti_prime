import { DomainError, HubDto, HubListDto, ListHubsInput } from '@shakti/contracts';
import { schema, type RequestContext, type RequestTx } from '@shakti/db';
import { asc, eq, inArray, isNull } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseQueryInput } from '../parse-input';

type HubRow = typeof schema.warehouses.$inferSelect;
type BinRow = typeof schema.bins.$inferSelect;

function toHubDto(hub: HubRow, bins: readonly BinRow[]): HubDto {
  return HubDto.parse({
    id: hub.id,
    code: hub.code,
    name: hub.name,
    kind: hub.kind,
    address: hub.address,
    stateCode: hub.stateCode,
    pinCode: hub.pinCode,
    archivedAt: hub.archivedAt?.toISOString() ?? null,
    bins: bins.map((b) => ({
      id: b.id,
      hubId: b.warehouseId,
      code: b.code,
      kind: b.kind,
      pairHubIds:
        b.pairAWarehouseId !== null && b.pairBWarehouseId !== null
          ? [b.pairAWarehouseId, b.pairBWarehouseId]
          : null,
      archivedAt: b.archivedAt?.toISOString() ?? null,
    })),
  });
}

/** One hub with all its bins, by code, as row security shows them (`inventory.stock.read`). */
export async function readHub(tx: RequestTx, hubId: string): Promise<HubDto> {
  const [hub] = await tx
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, hubId))
    .limit(1);
  if (!hub) throw new DomainError('not_found', 'hub not found', { reason: 'hub_missing' });
  const bins = await tx
    .select()
    .from(schema.bins)
    .where(eq(schema.bins.warehouseId, hubId))
    .orderBy(asc(schema.bins.code));
  return toHubDto(hub, bins);
}

/**
 * `/inventory/hubs` and the stock screens' pickers: every hub with its bins, by code; archived ones
 * only when asked. Hubs and bins are the group's, read with `inventory.stock.read` at any scope.
 */
export async function listHubs(
  ctx: Pick<RequestContext, 'tx' | 'principal'>,
  rawInput: unknown,
): Promise<HubListDto> {
  const input = parseQueryInput(ListHubsInput, rawInput, 'inventory.hub.list');
  checkPermission(ctx.principal, 'inventory.stock.read', 'own');
  const w = schema.warehouses;
  const hubs = await ctx.tx
    .select()
    .from(w)
    .where(input.includeArchived ? undefined : isNull(w.archivedAt))
    .orderBy(asc(w.code));
  if (hubs.length === 0) return { hubs: [] };
  const b = schema.bins;
  const bins = await ctx.tx
    .select()
    .from(b)
    .where(
      inArray(
        b.warehouseId,
        hubs.map((h) => h.id),
      ),
    )
    .orderBy(asc(b.code));
  const byHub = new Map<string, BinRow[]>();
  for (const bin of bins) {
    if (!input.includeArchived && bin.archivedAt !== null) continue;
    byHub.set(bin.warehouseId, [...(byHub.get(bin.warehouseId) ?? []), bin]);
  }
  return HubListDto.parse({ hubs: hubs.map((h) => toHubDto(h, byHub.get(h.id) ?? [])) });
}
