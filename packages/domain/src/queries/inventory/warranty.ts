import {
  ClaimSerialListDto,
  DomainError,
  GetWarrantyClaimInput,
  hasGrant,
  ListClaimSerialsInput,
  ListWarrantyClaimsInput,
  WARRANTY_CLAIM_STATES,
  WarrantyClaimCostsDto,
  WarrantyClaimDto,
  WarrantyClaimPageDto,
  type WarrantyClaimState,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { assertEntityInScope } from '../../commands/imports/shared';
import { checkPermission } from '../../command/run-command';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

/**
 * Warranty claims' reads (R3, docs/03-roadmap-appendix/phase3.md §7.5): the claims of a company
 * by state, one claim's sheet, the customer's delivered serials for identification, each with
 * `inventory.stock.read` or `inventory.warranty.write` for the company and none carrying a cost;
 * and a claim's costs, with `finance.cost.read` only.
 */

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const ListCursor = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

function readGuard(ctx: Ctx, entityId: number): void {
  assertEntityInScope(ctx.entityIds, entityId);
  const { permissions } = ctx.principal;
  if (
    !hasGrant(permissions, 'inventory.stock.read', 'entity') &&
    !hasGrant(permissions, 'inventory.warranty.write', 'entity')
  ) {
    throw new DomainError('forbidden', 'warranty claims need inventory.stock.read', {});
  }
}

interface ClaimRow {
  id: string;
  entityId: number;
  claimNo: string;
  state: string;
  stateChangedAt: string | Date;
  createdAt: string | Date;
  accountId: string;
  accountName: string | null;
  siteId: string | null;
  siteVillage: string | null;
  siteType: string | null;
  itemId: string | null;
  sku: string | null;
  itemName: string | null;
  reportedFault: string;
  vendorId: string | null;
  vendorName: string | null;
  supplierRmaRef: string | null;
  settlement: string | null;
  rejectedReason: string | null;
  serial: SerialJson | null;
  replacement: SerialJson | null;
  supplierSerial: SerialJson | null;
}

interface SerialJson {
  id: string;
  serialNo: string;
  state: string;
  warrantyUntil: string | null;
}

/** A serial of the claim as a JSON object, or null; read under the serials' own policy. */
const serialJson = (column: SQL) => sql`
  (select json_build_object('id', s.id, 'serialNo', s.serial_no, 'state', s.state,
                            'warrantyUntil', s.warranty_until::text)
     from serials s where s.id = ${column})`;

/** A claim's columns with its customer, site, item, vendor and serials, over the alias `c`. */
const CLAIM_SELECT = sql`
  c.id, c.entity_id as "entityId", c.claim_no as "claimNo", c.state,
  c.state_changed_at as "stateChangedAt", c.created_at as "createdAt",
  c.account_id as "accountId", a.name as "accountName",
  c.site_id as "siteId", cs.village as "siteVillage", cs.type as "siteType",
  c.item_id as "itemId", i.sku, i.name as "itemName", c.reported_fault as "reportedFault",
  c.vendor_id as "vendorId", v.name as "vendorName", c.supplier_rma_ref as "supplierRmaRef",
  c.settlement, c.rejected_reason as "rejectedReason",
  ${serialJson(sql`c.serial_id`)} as serial,
  ${serialJson(sql`c.replacement_serial_id`)} as replacement,
  ${serialJson(sql`c.supplier_serial_id`)} as "supplierSerial"`;

const CLAIM_JOINS = sql`
  left join accounts a on a.id = c.account_id
  left join customer_sites cs on cs.id = c.site_id
  left join items i on i.id = c.item_id
  left join vendors v on v.id = c.vendor_id`;

function toClaimDto(row: ClaimRow): WarrantyClaimDto {
  return WarrantyClaimDto.parse({
    id: row.id,
    entityId: row.entityId,
    claimNo: row.claimNo,
    state: row.state,
    stateChangedAt: new Date(row.stateChangedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    account: { id: row.accountId, name: row.accountName },
    // A site the viewer may not read shows as the site, without its details.
    site:
      row.siteId === null ? null : { id: row.siteId, village: row.siteVillage, type: row.siteType },
    item:
      row.itemId === null ? null : { id: row.itemId, sku: row.sku ?? '', name: row.itemName ?? '' },
    serial: row.serial,
    reportedFault: row.reportedFault,
    replacementSerial: row.replacement,
    vendor: row.vendorId === null ? null : { id: row.vendorId, name: row.vendorName ?? '' },
    supplierRmaRef: row.supplierRmaRef,
    settlement: row.settlement,
    supplierSerial: row.supplierSerial,
    rejectedReason: row.rejectedReason,
  });
}

/**
 * `/inventory/warranty`: one company's claims, in one state or all, newest first (keyset on the
 * time raised and id, by `warranty_claims_list_idx`), with how many stand in each state.
 */
export async function listWarrantyClaims(
  ctx: Ctx,
  rawInput: unknown,
): Promise<WarrantyClaimPageDto> {
  const input = parseQueryInput(ListWarrantyClaimsInput, rawInput, 'inventory.warranty.list');
  readGuard(ctx, input.entityId);
  const where: SQL[] = [sql`c.entity_id = ${input.entityId}`];
  if (input.state !== undefined) where.push(sql`c.state = ${input.state}`);
  if (input.cursor !== undefined) {
    const [at, id] = decodeCursor(ListCursor, input.cursor);
    where.push(sql`(c.created_at, c.id) < (${at}::timestamptz, ${id}::uuid)`);
  }
  // The page is found on the claims alone (by `warranty_claims_entity_created_idx`, or
  // `warranty_claims_list_idx` for one state), and only its rows join their customer and the rest.
  const rows = (await ctx.tx.execute(sql`
    with page as materialized (
      select c.* from warranty_claims c
       where ${sql.join(where, sql` and `)}
       order by c.created_at desc, c.id desc
       limit ${input.limit + 1}
    )
    select ${CLAIM_SELECT}
      from page c ${CLAIM_JOINS}
     order by c.created_at desc, c.id desc`)) as unknown as ClaimRow[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  const tallies = (await ctx.tx.execute(sql`
    select state, count(*)::int as n from warranty_claims
     where entity_id = ${input.entityId} group by state`)) as unknown as {
    state: WarrantyClaimState;
    n: number;
  }[];
  const counts = Object.fromEntries(WARRANTY_CLAIM_STATES.map((s) => [s, 0])) as Record<
    WarrantyClaimState,
    number
  >;
  for (const t of tallies) counts[t.state] = t.n;
  return WarrantyClaimPageDto.parse({
    items: page.map(toClaimDto),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor([new Date(last.createdAt).toISOString(), last.id])
        : null,
    counts,
  });
}

/** One claim's sheet. */
export async function getWarrantyClaim(ctx: Ctx, rawInput: unknown): Promise<WarrantyClaimDto> {
  const input = parseQueryInput(GetWarrantyClaimInput, rawInput, 'inventory.warranty.get');
  readGuard(ctx, input.entityId);
  const [row] = (await ctx.tx.execute(sql`
    select ${CLAIM_SELECT}
      from warranty_claims c ${CLAIM_JOINS}
     where c.id = ${input.claimId} and c.entity_id = ${input.entityId}`)) as unknown as ClaimRow[];
  if (!row) {
    throw new DomainError('not_found', 'warranty claim not found', {
      reason: 'warranty_claim_missing',
    });
  }
  return toClaimDto(row);
}

/**
 * The customer's serials the company delivered (`with_customer`), newest warranty first, each
 * with its open claim if it has one: what the claim sheet offers to identify (at most 200).
 */
export async function listClaimSerials(ctx: Ctx, rawInput: unknown): Promise<ClaimSerialListDto> {
  const input = parseQueryInput(ListClaimSerialsInput, rawInput, 'inventory.warranty.serials');
  assertEntityInScope(ctx.entityIds, input.entityId);
  checkPermission(ctx.principal, 'inventory.stock.read', 'entity');
  const rows = (await ctx.tx.execute(sql`
    select s.id, s.serial_no as "serialNo", s.warranty_until::text as "warrantyUntil",
           json_build_object('id', i.id, 'sku', i.sku, 'name', i.name) as item,
           (select c.id from warranty_claims c
             where c.serial_id = s.id and c.state not in ('closed', 'rejected')) as "openClaimId"
      from serials s
      join items i on i.id = s.item_id
     where s.account_id = ${input.accountId} and s.entity_id = ${input.entityId}
       and s.state = 'with_customer'
     order by s.warranty_until desc nulls last, s.serial_no
     limit 200`)) as unknown as ClaimSerialListDto['serials'];
  return ClaimSerialListDto.parse({ serials: rows });
}

/** A claim's costs (`finance.cost.read`): the replacement's cost and the supplier's credit. */
export async function readWarrantyClaimCosts(
  ctx: Ctx,
  rawInput: unknown,
): Promise<WarrantyClaimCostsDto> {
  const input = parseQueryInput(GetWarrantyClaimInput, rawInput, 'inventory.warranty.costs');
  assertEntityInScope(ctx.entityIds, input.entityId);
  checkPermission(ctx.principal, 'finance.cost.read', 'entity');
  const [row] = (await ctx.tx.execute(sql`
    select replacement_cost::text as "replacementCost",
           supplier_credit_amount::text as "supplierCreditAmount"
      from warranty_claim_costs
     where claim_id = ${input.claimId} and entity_id = ${input.entityId}`)) as unknown as {
    replacementCost: string | null;
    supplierCreditAmount: string | null;
  }[];
  return WarrantyClaimCostsDto.parse({
    claimId: input.claimId,
    replacementCost: row?.replacementCost ?? null,
    supplierCreditAmount: row?.supplierCreditAmount ?? null,
  });
}
