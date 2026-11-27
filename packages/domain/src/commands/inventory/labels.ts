import {
  DomainError,
  LabelSheetDto,
  newId,
  PrintLabelsInput,
  ReprintLabelsInput,
  type PrintableLabelKind,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { assertEntityInScope } from '../imports/shared';

/**
 * Printing QR labels (Q1, docs/03-roadmap-appendix/phase3.md §7.4). Each command checks that the
 * caller may read every serial or bin it names (the `serials` and `bins` policies, a serial only
 * of the company), then asks the render worker for one sheet (`print.labels.requested`), whose PDF
 * is stored under the sheet's id at the label stock's size (`WORKSHOP_DEFAULTS.labels`). A reprint
 * says why and is audited on each serial or bin it labels again. Neither writes a table: the
 * labels carry only ids, so printing one again never changes what it says.
 */

/** A bin is the group's, so its audit row belongs to no one company, as the hub commands write. */
const GROUP = null;

/** The ids given, each one the caller may read, or `label_target_missing`. */
async function assertTargets(
  ctx: CommandContext,
  entityId: number,
  labelKind: PrintableLabelKind,
  ids: readonly string[],
): Promise<void> {
  let found: { id: string }[];
  if (labelKind === 'serial') {
    const s = schema.serials;
    found = await ctx.tx
      .select({ id: s.id })
      .from(s)
      .where(and(inArray(s.id, [...ids]), eq(s.entityId, entityId)));
  } else {
    const b = schema.bins;
    found = await ctx.tx
      .select({ id: b.id })
      .from(b)
      .where(and(inArray(b.id, [...ids]), isNull(b.archivedAt)));
  }
  if (found.length !== ids.length) {
    throw new DomainError('not_found', 'a label names a serial or bin not in reach', {
      reason: 'label_target_missing',
      missing: ids.length - found.length,
    });
  }
}

/** Asks the render worker for the sheet, and answers it. */
function requestSheet(
  ctx: CommandContext,
  entityId: number,
  labelKind: PrintableLabelKind,
  ids: readonly string[],
): LabelSheetDto {
  const sheetId = newId();
  const size = WORKSHOP_DEFAULTS.labels.sizeByKind[labelKind];
  ctx.emit({
    type: 'print.labels.requested',
    entityId,
    aggregateType: 'label_sheet',
    aggregateId: sheetId,
    payload: { sheetId, labelKind, size, ids: [...ids] },
  });
  return {
    sheetId,
    entityId,
    labelKind,
    size,
    count: ids.length,
    requestedAt: ctx.now.toISOString(),
  };
}

/**
 * `inventory.label.print`: a sheet of labels for serials of the company (every serial of a
 * receipt, or one) or the group's bins (a hub's, or one), in the order given.
 */
export const printLabels = defineCommand({
  name: 'inventory.label.print',
  permission: 'inventory.stock.move',
  minScope: 'entity',
  peopleOnly: true,
  input: PrintLabelsInput,
  output: LabelSheetDto,
  auditFields: ['labelKind', 'labelCount'],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    await assertTargets(ctx, input.entityId, input.labelKind, input.ids);
    const sheet = requestSheet(ctx, input.entityId, input.labelKind, input.ids);
    ctx.audit({
      aggregateType: 'label_sheet',
      aggregateId: sheet.sheetId,
      entityId: input.entityId,
      after: { labelKind: input.labelKind, labelCount: sheet.count },
    });
    return sheet;
  },
});

/**
 * `inventory.label.reprint`: labels printed again with why (a torn, faded or lost label),
 * audited on each serial or bin with the kind, how many the sheet holds and the note.
 */
export const reprintLabels = defineCommand({
  name: 'inventory.label.reprint',
  permission: 'inventory.stock.move',
  minScope: 'entity',
  peopleOnly: true,
  input: ReprintLabelsInput,
  output: LabelSheetDto,
  auditFields: ['labelKind', 'labelCount', 'labelNote'],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    await assertTargets(ctx, input.entityId, input.labelKind, input.ids);
    const sheet = requestSheet(ctx, input.entityId, input.labelKind, input.ids);
    for (const id of input.ids) {
      ctx.audit({
        aggregateType: input.labelKind,
        aggregateId: id,
        entityId: input.labelKind === 'bin' ? GROUP : input.entityId,
        after: {
          labelKind: input.labelKind,
          labelCount: sheet.count,
          labelNote: input.note,
          labelSheetId: sheet.sheetId,
        },
      });
    }
    return sheet;
  },
});
