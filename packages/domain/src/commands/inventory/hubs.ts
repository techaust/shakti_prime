import {
  ArchiveBinInput,
  ArchiveHubInput,
  BinDto,
  CreateBinInput,
  CreateHubInput,
  DomainError,
  HubDto,
  newId,
  UpdateBinInput,
  UpdateHubInput,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { readHub } from '../../queries/inventory/hubs';

/**
 * Hubs and bins (H1, docs/03-roadmap-appendix/phase3.md §5): shared by the group (question 1 (a)),
 * so they are written with `inventory.stock.adjust` for every company, which only the Executive
 * holds. Every godown and factory gets its receiving and dispatch bins when made; the transit hub
 * has one bin per pair of the other hubs, made as either side appears.
 */

const HUB_AUDIT_FIELDS = [
  'hubCode',
  'hubName',
  'hubKind',
  'hubAddress',
  'hubStateCode',
  'hubPinCode',
  'archivedAt',
] as const;
const BIN_AUDIT_FIELDS = ['binCode', 'binKind', 'archivedAt'] as const;

const HUB_CONSTRAINTS = {
  warehouses_code_unique: 'hub_code_taken',
  warehouses_site_check: 'hub_site_missing',
  hub_holds_stock: 'hub_holds_stock',
  hub_kind_fixed: 'hub_kind_fixed',
  bins_warehouse_code_unique: 'bin_code_taken',
  bin_holds_stock: 'bin_holds_stock',
} as const;
const BIN_CONSTRAINTS = {
  bins_warehouse_code_unique: 'bin_code_taken',
  bin_holds_stock: 'bin_holds_stock',
  bin_fixed: 'bin_kind_fixed',
  bin_kind_hub: 'bin_hub_unavailable',
  bins_warehouse_kind_unique: 'bin_code_taken',
} as const;

type HubRow = typeof schema.warehouses.$inferSelect;
type BinRow = typeof schema.bins.$inferSelect;

function auditedHub(row: HubRow) {
  return {
    hubCode: row.code,
    hubName: row.name,
    hubKind: row.kind,
    hubAddress: row.address,
    hubStateCode: row.stateCode,
    hubPinCode: row.pinCode,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

function auditedBin(row: BinRow) {
  return {
    binCode: row.code,
    binKind: row.kind,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/** The company an event or audit row about a shared hub is filed under: none (the group's). */
const GROUP = null;

async function lockHub(ctx: CommandContext, hubId: string): Promise<HubRow> {
  const [row] = await ctx.tx
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, hubId))
    .limit(1)
    .for('update');
  if (!row) throw new DomainError('not_found', 'hub not found', { reason: 'hub_missing' });
  return row;
}

async function lockBin(ctx: CommandContext, binId: string): Promise<BinRow> {
  const [row] = await ctx.tx
    .select()
    .from(schema.bins)
    .where(eq(schema.bins.id, binId))
    .limit(1)
    .for('update');
  if (!row) throw new DomainError('not_found', 'bin not found', { reason: 'bin_missing' });
  return row;
}

/** A transit bin's code: its two hubs' codes, within the bin code's length. */
function pairCode(a: HubRow, b: HubRow): string {
  return `${a.code}-${b.code}`.slice(0, 41);
}

/**
 * The transit bins a new hub needs: for a transit hub, one per pair of the godowns and factories
 * in use; for a godown or factory, one in each transit hub pairing it with each other one.
 */
async function addTransitBins(ctx: CommandContext, hub: HubRow): Promise<BinRow[]> {
  const w = schema.warehouses;
  const live = await ctx.tx
    .select()
    .from(w)
    .where(and(isNull(w.archivedAt), ne(w.id, hub.id)))
    .orderBy(w.id);
  const sites = live.filter((h) => h.kind !== 'transit');
  const pairs: { transit: HubRow; a: HubRow; b: HubRow }[] = [];
  if (hub.kind === 'transit') {
    for (let i = 0; i < sites.length; i += 1) {
      for (let j = i + 1; j < sites.length; j += 1) {
        const a = sites[i];
        const b = sites[j];
        if (a && b) pairs.push({ transit: hub, a, b });
      }
    }
  } else {
    for (const transit of live.filter((h) => h.kind === 'transit')) {
      for (const other of sites) {
        const [a, b] = hub.id < other.id ? [hub, other] : [other, hub];
        pairs.push({ transit, a, b });
      }
    }
  }
  if (pairs.length === 0) return [];
  return ctx.tx
    .insert(schema.bins)
    .values(
      pairs.map((p) => ({
        id: newId(),
        warehouseId: p.transit.id,
        code: pairCode(p.a, p.b),
        kind: 'transit',
        pairAWarehouseId: p.a.id,
        pairBWarehouseId: p.b.id,
        createdBy: ctx.principal.id,
      })),
    )
    .returning();
}

/** `inventory.hub.create`: a hub, with its receiving and dispatch bins, or the transit hub. */
export const createHub = defineCommand({
  name: 'inventory.hub.create',
  permission: 'inventory.stock.adjust',
  minScope: 'all',
  peopleOnly: true,
  input: CreateHubInput,
  output: HubDto,
  auditFields: [...HUB_AUDIT_FIELDS, 'binCode', 'binKind'],
  constraintReasons: HUB_CONSTRAINTS,
  async handler(ctx, input) {
    const [hub] = await ctx.tx
      .insert(schema.warehouses)
      .values({
        id: newId(),
        code: input.code,
        name: input.name,
        kind: input.kind,
        address: input.address,
        stateCode: input.stateCode,
        pinCode: input.pinCode,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!hub) throw new DomainError('internal', 'hub insert returned no row');
    ctx.audit({
      aggregateType: 'warehouse',
      aggregateId: hub.id,
      entityId: GROUP,
      before: null,
      after: auditedHub(hub),
    });
    const bins =
      hub.kind === 'transit'
        ? []
        : await ctx.tx
            .insert(schema.bins)
            .values([
              {
                id: newId(),
                warehouseId: hub.id,
                code: 'RECEIVING',
                kind: 'receiving',
                createdBy: ctx.principal.id,
              },
              {
                id: newId(),
                warehouseId: hub.id,
                code: 'DISPATCH',
                kind: 'dispatch',
                createdBy: ctx.principal.id,
              },
            ])
            .returning();
    for (const bin of [...bins, ...(await addTransitBins(ctx, hub))]) {
      ctx.audit({
        aggregateType: 'bin',
        aggregateId: bin.id,
        entityId: GROUP,
        before: null,
        after: auditedBin(bin),
      });
    }
    return readHub(ctx.tx, hub.id);
  },
});

/** `inventory.hub.update`: a hub's code, name and site; its kind stays as made. */
export const updateHub = defineCommand({
  name: 'inventory.hub.update',
  permission: 'inventory.stock.adjust',
  minScope: 'all',
  peopleOnly: true,
  input: UpdateHubInput,
  output: HubDto,
  auditFields: HUB_AUDIT_FIELDS,
  constraintReasons: HUB_CONSTRAINTS,
  async handler(ctx, input) {
    const before = await lockHub(ctx, input.hubId);
    if (before.archivedAt !== null) {
      throw new DomainError('conflict', 'hub archived', { reason: 'hub_archived' });
    }
    const [after] = await ctx.tx
      .update(schema.warehouses)
      .set({
        code: input.code,
        name: input.name,
        address: input.address,
        stateCode: input.stateCode,
        pinCode: input.pinCode,
        updatedBy: ctx.principal.id,
      })
      .where(eq(schema.warehouses.id, before.id))
      .returning();
    if (!after) throw new DomainError('internal', 'hub update returned no row');
    ctx.audit({
      aggregateType: 'warehouse',
      aggregateId: after.id,
      entityId: GROUP,
      before: auditedHub(before),
      after: auditedHub(after),
    });
    return readHub(ctx.tx, after.id);
  },
});

/** `inventory.hub.archive`: a hub that holds no stock, with its bins. */
export const archiveHub = defineCommand({
  name: 'inventory.hub.archive',
  permission: 'inventory.stock.adjust',
  minScope: 'all',
  peopleOnly: true,
  input: ArchiveHubInput,
  output: HubDto,
  auditFields: ['archivedAt'],
  constraintReasons: HUB_CONSTRAINTS,
  async handler(ctx, input) {
    const before = await lockHub(ctx, input.hubId);
    if (before.archivedAt !== null) return readHub(ctx.tx, before.id);
    // The hub's guard refuses it while any bin holds stock of any company.
    const [after] = await ctx.tx
      .update(schema.warehouses)
      .set({ archivedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(eq(schema.warehouses.id, before.id))
      .returning();
    if (!after) throw new DomainError('internal', 'hub archive returned no row');
    await ctx.tx
      .update(schema.bins)
      .set({ archivedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(and(eq(schema.bins.warehouseId, before.id), isNull(schema.bins.archivedAt)));
    ctx.audit({
      aggregateType: 'warehouse',
      aggregateId: after.id,
      entityId: GROUP,
      before: { archivedAt: null },
      after: { archivedAt: ctx.now.toISOString() },
    });
    return readHub(ctx.tx, after.id);
  },
});

async function liveSiteHub(tx: RequestTx, hubId: string): Promise<HubRow> {
  const [hub] = await tx
    .select()
    .from(schema.warehouses)
    .where(eq(schema.warehouses.id, hubId))
    .limit(1);
  if (!hub) throw new DomainError('not_found', 'hub not found', { reason: 'hub_missing' });
  if (hub.archivedAt !== null || hub.kind === 'transit') {
    throw new DomainError('conflict', 'bins are added to a godown or factory in use', {
      reason: 'bin_hub_unavailable',
    });
  }
  return hub;
}

function toBinDto(row: BinRow): BinDto {
  return BinDto.parse({
    id: row.id,
    hubId: row.warehouseId,
    code: row.code,
    kind: row.kind,
    pairHubIds:
      row.pairAWarehouseId !== null && row.pairBWarehouseId !== null
        ? [row.pairAWarehouseId, row.pairBWarehouseId]
        : null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  });
}

/** `inventory.bin.create`: a storage, quarantine or surplus bin of a godown or factory. */
export const createBin = defineCommand({
  name: 'inventory.bin.create',
  permission: 'inventory.stock.adjust',
  minScope: 'all',
  peopleOnly: true,
  input: CreateBinInput,
  output: BinDto,
  auditFields: BIN_AUDIT_FIELDS,
  constraintReasons: BIN_CONSTRAINTS,
  async handler(ctx, input) {
    const hub = await liveSiteHub(ctx.tx, input.hubId);
    const [bin] = await ctx.tx
      .insert(schema.bins)
      .values({
        id: newId(),
        warehouseId: hub.id,
        code: input.code,
        kind: input.kind,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!bin) throw new DomainError('internal', 'bin insert returned no row');
    ctx.audit({
      aggregateType: 'bin',
      aggregateId: bin.id,
      entityId: GROUP,
      before: null,
      after: auditedBin(bin),
    });
    return toBinDto(bin);
  },
});

/** `inventory.bin.update`: a bin's code, and the kind of a storage, quarantine or surplus bin. */
export const updateBin = defineCommand({
  name: 'inventory.bin.update',
  permission: 'inventory.stock.adjust',
  minScope: 'all',
  peopleOnly: true,
  input: UpdateBinInput,
  output: BinDto,
  auditFields: BIN_AUDIT_FIELDS,
  constraintReasons: BIN_CONSTRAINTS,
  async handler(ctx, input) {
    const before = await lockBin(ctx, input.binId);
    if (before.archivedAt !== null) {
      throw new DomainError('conflict', 'bin archived', { reason: 'bin_archived' });
    }
    const [after] = await ctx.tx
      .update(schema.bins)
      .set({ code: input.code, kind: input.kind ?? before.kind, updatedBy: ctx.principal.id })
      .where(eq(schema.bins.id, before.id))
      .returning();
    if (!after) throw new DomainError('internal', 'bin update returned no row');
    ctx.audit({
      aggregateType: 'bin',
      aggregateId: after.id,
      entityId: GROUP,
      before: auditedBin(before),
      after: auditedBin(after),
    });
    return toBinDto(after);
  },
});

/**
 * `inventory.bin.archive`: a bin that holds no stock of any company. A hub's receiving, dispatch
 * and transit bins stay while the hub is in use.
 */
export const archiveBin = defineCommand({
  name: 'inventory.bin.archive',
  permission: 'inventory.stock.adjust',
  minScope: 'all',
  peopleOnly: true,
  input: ArchiveBinInput,
  output: BinDto,
  auditFields: ['archivedAt'],
  constraintReasons: BIN_CONSTRAINTS,
  async handler(ctx, input) {
    const before = await lockBin(ctx, input.binId);
    if (before.archivedAt !== null) return toBinDto(before);
    if (before.kind === 'receiving' || before.kind === 'dispatch' || before.kind === 'transit') {
      throw new DomainError('conflict', 'a hub keeps this bin', { reason: 'bin_required' });
    }
    const [after] = await ctx.tx
      .update(schema.bins)
      .set({ archivedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(eq(schema.bins.id, before.id))
      .returning();
    if (!after) throw new DomainError('internal', 'bin archive returned no row');
    ctx.audit({
      aggregateType: 'bin',
      aggregateId: after.id,
      entityId: GROUP,
      before: { archivedAt: null },
      after: { archivedAt: ctx.now.toISOString() },
    });
    return toBinDto(after);
  },
});
