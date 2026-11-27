import {
  DomainError,
  hasGrant,
  LineAvailabilityDto,
  PreviewLineAvailabilityInput,
  ReadLineAvailabilityInput,
  type Principal,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { reservationCall } from '../../stock/reserve';
import { parseQueryInput } from '../parse-input';

/** Whether the caller sees availability with its quantities (the Inventory Manager, the GM, the Executive). */
export function readsStockCounts(principal: Principal): boolean {
  return hasGrant(principal.permissions, 'inventory.stock.read', 'entity');
}

interface StatusRow {
  lineId: string | null;
  position: number;
  status: string;
  expectedOn: string | null;
}

interface StockRow extends StatusRow {
  free: string | null;
  reserved: string | null;
  backordered: string | null;
  dispatched: string | null;
}

/**
 * Availability per line of a quote or an order (H2, question 4 (a), PRD SAL-04), from
 * `app.line_availability()`. A holder of `inventory.stock.read` for the company gets the status
 * with the quantities; a holder of `sales.quote.create` alone gets the status and the expected
 * date, a shape with no count, built from a select that never names the definer's count columns.
 * A quote never reserves: this only reads.
 */
function requireCompany(ctx: Pick<RequestContext, 'entityIds'>, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

export async function readLineAvailability(
  ctx: Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>,
  rawInput: unknown,
): Promise<LineAvailabilityDto> {
  const input = parseQueryInput(ReadLineAvailabilityInput, rawInput, 'inventory.availability.read');
  requireCompany(ctx, input.entityId);
  if (readsStockCounts(ctx.principal)) {
    const rows = await reservationCall<StockRow>(
      ctx.tx,
      sql`select line_id as "lineId", line_position as "position", status,
                 expected_on::text as "expectedOn",
                 qty_free::numeric(12, 3)::text as "free",
                 qty_reserved::numeric(12, 3)::text as "reserved",
                 qty_backordered::numeric(12, 3)::text as "backordered",
                 qty_dispatched::numeric(12, 3)::text as "dispatched"
            from app.line_availability(${input.kind}, ${input.id}::uuid)`,
    );
    return LineAvailabilityDto.parse({ withCounts: true, lines: rows });
  }
  checkPermission(ctx.principal, 'sales.quote.create', 'own');
  const rows = await reservationCall<StatusRow>(
    ctx.tx,
    sql`select line_id as "lineId", line_position as "position", status,
               expected_on::text as "expectedOn"
          from app.line_availability(${input.kind}, ${input.id}::uuid)`,
  );
  return LineAvailabilityDto.parse({ withCounts: false, lines: rows });
}

/**
 * The quote builder's lines before the quote is made (`app.preview_availability()`), in the same
 * two shapes: the free quantity only for a holder of `inventory.stock.read` for the company.
 */
export async function previewLineAvailability(
  ctx: Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>,
  rawInput: unknown,
): Promise<LineAvailabilityDto> {
  const input = parseQueryInput(
    PreviewLineAvailabilityInput,
    rawInput,
    'inventory.availability.preview',
  );
  requireCompany(ctx, input.entityId);
  const lines = JSON.stringify(
    input.lines.map((l) => ({
      line_id: null,
      position: l.position,
      item_id: l.itemId ?? null,
      kit_id: l.kitId ?? null,
      qty: l.qty,
    })),
  );
  if (readsStockCounts(ctx.principal)) {
    const rows = await reservationCall<StockRow>(
      ctx.tx,
      sql`select null::uuid as "lineId", line_position as "position", status,
                 expected_on::text as "expectedOn",
                 qty_free::numeric(12, 3)::text as "free",
                 null::text as "reserved", null::text as "backordered", null::text as "dispatched"
            from app.preview_availability(${input.entityId}::smallint, ${lines}::jsonb)`,
    );
    return LineAvailabilityDto.parse({ withCounts: true, lines: rows });
  }
  checkPermission(ctx.principal, 'sales.quote.create', 'own');
  const rows = await reservationCall<StatusRow>(
    ctx.tx,
    sql`select null::uuid as "lineId", line_position as "position", status,
               expected_on::text as "expectedOn"
          from app.preview_availability(${input.entityId}::smallint, ${lines}::jsonb)`,
  );
  return LineAvailabilityDto.parse({ withCounts: false, lines: rows });
}
