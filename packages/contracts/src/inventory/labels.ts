import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { BinKindSchema, SerialStateSchema } from './enums';

/**
 * QR labels (Q1, docs/03-roadmap-appendix/phase3.md §7.4): a serial's, a bin's and a dispatch
 * package's, printed as PDF labels at the label stock's size (question 9 (a)) by the render
 * worker. Each QR code carries `SP1:<kind letter>:<id>`, which `parseLabelPayload()` in
 * `@shakti/domain` reads back.
 */

/** Label stock sizes in millimetres, one label per page (docs/04-architecture-appendix/print.md). */
export const LABEL_SIZES = ['50x25', '100x50'] as const;
export const LabelSizeSchema = z.enum(LABEL_SIZES);
export type LabelSize = z.infer<typeof LabelSizeSchema>;

/** What a label is for. A package label is printed by dispatch (D2), which adds its packages. */
export const LABEL_KINDS = ['serial', 'bin', 'package'] as const;
export const LabelKindSchema = z.enum(LABEL_KINDS);
export type LabelKind = z.infer<typeof LabelKindSchema>;

/** The kinds a person prints from the stock screens until dispatch adds its packages. */
export const PRINTABLE_LABEL_KINDS = ['serial', 'bin'] as const;
export const PrintableLabelKindSchema = z.enum(PRINTABLE_LABEL_KINDS);
export type PrintableLabelKind = z.infer<typeof PrintableLabelKindSchema>;

/** At most this many labels in one sheet: the render job's own limit. */
export const LABEL_SHEET_MAX = 500;
/** At most this many labels in one reprint, each audited on its own serial or bin. */
export const LABEL_REPRINT_MAX = 100;

const distinctIds = (max: number) =>
  z
    .array(IdSchema)
    .min(1)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'each label once' });

/**
 * `inventory.label.print`: a sheet of labels of one company, for serials it holds or the group's
 * bins (a hub's bins, or a bin), in the order given.
 */
export const PrintLabelsInput = z
  .object({
    entityId: EntityIdSchema,
    labelKind: PrintableLabelKindSchema,
    ids: distinctIds(LABEL_SHEET_MAX),
  })
  .strict();
export type PrintLabelsInput = z.input<typeof PrintLabelsInput>;

/** `inventory.label.reprint`: labels printed again, with why (a torn, faded or lost label). */
export const ReprintLabelsInput = z
  .object({
    entityId: EntityIdSchema,
    labelKind: PrintableLabelKindSchema,
    ids: distinctIds(LABEL_REPRINT_MAX),
    note: z.string().trim().min(3).max(300),
  })
  .strict();
export type ReprintLabelsInput = z.input<typeof ReprintLabelsInput>;

/** The sheet asked for: its id is the id its PDF is stored under once the worker prints it. */
export const LabelSheetDto = z
  .object({
    sheetId: IdSchema,
    entityId: EntityIdSchema,
    labelKind: PrintableLabelKindSchema,
    size: LabelSizeSchema,
    count: z.number().int().min(1).max(LABEL_SHEET_MAX),
    requestedAt: z.iso.datetime(),
  })
  .strict();
export type LabelSheetDto = z.infer<typeof LabelSheetDto>;

/** What a serial label prints. */
export const SerialLabelDto = z
  .object({
    id: IdSchema,
    serialNo: z.string(),
    sku: z.string(),
    itemName: z.string(),
    companyName: z.string(),
  })
  .strict();
export type SerialLabelDto = z.infer<typeof SerialLabelDto>;

/** What a bin label prints. */
export const BinLabelDto = z
  .object({ id: IdSchema, binCode: z.string(), hubCode: z.string(), hubName: z.string() })
  .strict();
export type BinLabelDto = z.infer<typeof BinLabelDto>;

/** A sheet's labels as the render worker reads them, in the order asked for. */
export const LabelsForPrintDto = z.discriminatedUnion('labelKind', [
  z.object({ labelKind: z.literal('serial'), labels: z.array(SerialLabelDto) }).strict(),
  z.object({ labelKind: z.literal('bin'), labels: z.array(BinLabelDto) }).strict(),
]);
export type LabelsForPrintDto = z.infer<typeof LabelsForPrintDto>;

/** A code read by a scanner or the camera: whatever it typed, as long as a label holds. */
export const ResolveScannedCodeInput = z.object({ code: z.string().max(400) }).strict();
export type ResolveScannedCodeInput = z.input<typeof ResolveScannedCodeInput>;

/**
 * What a scanned code is: a serial or bin the caller may read, `unknown` for a label of ours that
 * names nothing the caller can see (or a package, until dispatch adds them), and `not_ours` for a
 * code no BOS label carries (a supplier's barcode, a web address).
 */
export const ScannedCodeDto = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('serial'),
      serialId: IdSchema,
      entityId: EntityIdSchema,
      itemId: IdSchema,
      sku: z.string(),
      itemName: z.string(),
      serialNo: z.string(),
      state: SerialStateSchema,
      binId: IdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('bin'),
      binId: IdSchema,
      hubId: IdSchema,
      binCode: z.string(),
      hubCode: z.string(),
      kind: BinKindSchema,
    })
    .strict(),
  z.object({ outcome: z.literal('unknown') }).strict(),
  z.object({ outcome: z.literal('not_ours') }).strict(),
]);
export type ScannedCodeDto = z.infer<typeof ScannedCodeDto>;
