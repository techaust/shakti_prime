import {
  DomainError,
  LabelsForPrintDto,
  ResolveScannedCodeInput,
  ScannedCodeDto,
  type LabelKind,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseLabelPayload } from '../../labels/payload';
import { parseQueryInput } from '../parse-input';

/**
 * Labels' reads (Q1, docs/03-roadmap-appendix/phase3.md §7.4): what a scanned code names, under
 * the caller's own row security, and what a sheet of labels prints, for the render worker.
 */

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const UNKNOWN: ScannedCodeDto = { outcome: 'unknown' };

/**
 * What a code read by a scanner or the camera names (the scan field's `resolve(code)`): the
 * serial or bin of a BOS label when the caller may read it, through the `serials` and `bins`
 * policies (`inventory.stock.read`; a serial only of the request's companies); `unknown` for a
 * label of ours that names nothing the caller can see, an archived bin, or a package until
 * dispatch (D2) adds them; `not_ours` for any other code. Nothing is opened for either.
 */
export async function resolveScannedCode(ctx: Ctx, rawInput: unknown): Promise<ScannedCodeDto> {
  const input = parseQueryInput(ResolveScannedCodeInput, rawInput, 'inventory.label.resolve');
  checkPermission(ctx.principal, 'inventory.stock.read', 'own');
  const parsed = parseLabelPayload(input.code);
  if (parsed.kind === 'foreign') return { outcome: 'not_ours' };
  if (parsed.kind === 'unknown') return UNKNOWN;
  if (parsed.labelKind === 'serial') {
    const s = schema.serials;
    const i = schema.items;
    const [serial] = await ctx.tx
      .select({
        serialId: s.id,
        entityId: s.entityId,
        itemId: s.itemId,
        sku: i.sku,
        itemName: i.name,
        serialNo: s.serialNo,
        state: s.state,
        binId: s.binId,
      })
      .from(s)
      .innerJoin(i, eq(i.id, s.itemId))
      .where(and(eq(s.id, parsed.id), inArray(s.entityId, ctx.entityIds)))
      .limit(1);
    return serial === undefined ? UNKNOWN : ScannedCodeDto.parse({ outcome: 'serial', ...serial });
  }
  if (parsed.labelKind === 'bin') {
    const b = schema.bins;
    const w = schema.warehouses;
    const [bin] = await ctx.tx
      .select({ binId: b.id, hubId: b.warehouseId, binCode: b.code, hubCode: w.code, kind: b.kind })
      .from(b)
      .innerJoin(w, eq(w.id, b.warehouseId))
      .where(and(eq(b.id, parsed.id), isNull(b.archivedAt)))
      .limit(1);
    return bin === undefined ? UNKNOWN : ScannedCodeDto.parse({ outcome: 'bin', ...bin });
  }
  return UNKNOWN;
}

/**
 * What a sheet of labels prints, read by the render worker (`system:workers` of the sheet's
 * company, `files.process`) through `app.labels_for_print()`, in the order asked. A package sheet
 * waits for dispatch (D2), which adds its packages and their loader.
 */
export async function loadLabelsForPrint(
  ctx: Pick<RequestContext, 'tx'>,
  labelKind: LabelKind,
  ids: readonly string[],
): Promise<LabelsForPrintDto> {
  if (labelKind === 'package') {
    throw new DomainError('not_found', 'package labels are printed once dispatch adds packages', {
      reason: 'document_type_unknown',
    });
  }
  const rows = (await ctx.tx.execute(
    sql`select app.labels_for_print(${labelKind}, ${`{${ids.join(',')}}`}::uuid[]) as sheet`,
  )) as unknown as { sheet: unknown }[];
  return LabelsForPrintDto.parse(rows[0]?.sheet);
}
