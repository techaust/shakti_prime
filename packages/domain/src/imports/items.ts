import {
  CreateItemInput,
  ItemCategorySchema,
  ItemImportRowInput,
  ItemUnitSchema,
  serialPatternProblem,
  UpdateItemInput,
  type ImportRowErrorDto,
  type ItemCategory,
  type ItemImportField,
  type ItemImportMapping,
  type ItemUnit,
} from '@shakti/contracts';

/**
 * The items file of the catalogue (phase3 §6.1, C5): each row read into the fields it gives, then
 * checked as the item it would make or change, through the same input `catalogue.item.create` and
 * `.update` take, so no row the preview accepts is refused by the command for its own values.
 */

/** What reading one row found: the fields it gives, or why it cannot be imported. */
export type ItemRowRead =
  | { state: 'valid'; input: ItemImportRowInput; errors: [] }
  | { state: 'invalid'; input: null; errors: ImportRowErrorDto[] };

/** An item of the catalogue as the merge reads it: every field a row may leave as it is. */
export interface ExistingItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  hsn: string;
  unit: string;
  isSerialTracked: boolean;
  isDcr: boolean;
  almmRef: string | null;
  specsJson: unknown;
  warrantyMonths: number | null;
  supplierWarrantyMonths: number | null;
  barcode: string | null;
  purchaseUnit: string | null;
  purchaseUnitFactor: string | null;
  serialPattern: string | null;
  isStocked: boolean;
  archivedAt: Date | null;
}

const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Category words people write besides the list's own (`Solar module` and `solar_module` fold alike). */
const CATEGORY_WORDS: Readonly<Record<string, ItemCategory>> = {
  ...Object.fromEntries(ItemCategorySchema.options.map((c) => [fold(c), c])),
  solarpanel: 'solar_module',
  panel: 'solar_module',
  module: 'solar_module',
  mountingstructure: 'structure',
  vfd: 'controller',
};

/** Units as spreadsheets write them. */
const UNIT_WORDS: Readonly<Record<string, ItemUnit>> = {
  ...Object.fromEntries(ItemUnitSchema.options.map((u) => [u, u])),
  no: 'nos',
  pc: 'nos',
  pcs: 'nos',
  piece: 'nos',
  pieces: 'nos',
  sets: 'set',
  m: 'metre',
  mtr: 'metre',
  mtrs: 'metre',
  meter: 'metre',
  meters: 'metre',
  metres: 'metre',
  kgs: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  l: 'litre',
  ltr: 'litre',
  liter: 'litre',
  liters: 'litre',
  litres: 'litre',
  hr: 'hour',
  hrs: 'hour',
  hours: 'hour',
};

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);

/**
 * A barcode the file reader hid as an identity number: twelve digits whose check digit is an
 * Aadhaar number's keep only their last four (`withoutIdentityNumbers`), which is no barcode.
 */
const HIDDEN_NUMBER = /^X{8}\d{4}$/;

/**
 * Reads one row of an items file: the item code, and each other field its cell gives, in the
 * form the commands take. A category, HSN code or unit outside the lists, a serial pattern the
 * catalogue refuses, a hidden or malformed barcode, or any other value that does not fit is
 * refused with its field and reason.
 */
export function readItemRow(
  raw: Readonly<Record<string, string>>,
  mapping: ItemImportMapping,
): ItemRowRead {
  const cell = (field: ItemImportField): string | undefined => {
    const column = mapping.columns[field];
    const value = column === undefined ? '' : (raw[column] ?? '').replace(/\s+/g, ' ').trim();
    return value === '' ? undefined : value;
  };
  const errors = new Map<string, ImportRowErrorDto>();
  const add = (field: ItemImportField, code: ImportRowErrorDto['code']) => {
    if (!errors.has(field)) errors.set(field, { field, code });
  };
  const given: Record<string, unknown> = {};

  const sku = cell('sku');
  if (sku === undefined) add('sku', 'required');

  const name = cell('itemName');
  if (name !== undefined) given.name = name;

  const category = cell('category');
  if (category !== undefined) {
    const known = CATEGORY_WORDS[fold(category)];
    if (known === undefined) add('category', 'category_unknown');
    else given.category = known;
  }

  const hsn = cell('hsn');
  if (hsn !== undefined) {
    // People write HSN codes grouped (`8413 70 10`, `8413.70.10`); the digits are the code.
    const digits = hsn.replace(/[\s.]/g, '');
    if (/^([0-9]{4}|[0-9]{6}|[0-9]{8})$/.test(digits)) given.hsn = digits;
    else add('hsn', 'hsn_invalid');
  }

  for (const field of ['unit', 'purchaseUnit'] as const) {
    const unit = cell(field);
    if (unit === undefined) continue;
    const known = UNIT_WORDS[unit.toLowerCase().replace(/\.$/, '')];
    if (known === undefined) add(field, 'unit_unknown');
    else given[field] = known;
  }

  for (const field of ['isSerialTracked', 'isDcr'] as const) {
    const flag = cell(field)?.toLowerCase();
    if (flag === undefined) continue;
    if (YES.has(flag)) given[field] = true;
    else if (NO.has(flag)) given[field] = false;
    else add(field, 'invalid');
  }

  for (const field of ['warrantyMonths', 'supplierWarrantyMonths'] as const) {
    const months = cell(field);
    if (months === undefined) continue;
    if (/^\d{1,3}$/.test(months) && Number(months) <= 360) given[field] = Number(months);
    else add(field, 'invalid');
  }

  const factor = cell('purchaseUnitFactor')?.replaceAll(',', '');
  if (factor !== undefined) given.purchaseUnitFactor = factor;

  const almmRef = cell('almmRef');
  if (almmRef !== undefined) given.almmRef = almmRef;

  const barcode = cell('barcode');
  if (barcode !== undefined) {
    if (HIDDEN_NUMBER.test(barcode)) add('barcode', 'barcode_hidden');
    else given.barcode = barcode;
  }

  const pattern = cell('serialPattern');
  if (pattern !== undefined) {
    if (serialPatternProblem(pattern) === undefined) given.serialPattern = pattern;
    else add('serialPattern', 'serial_pattern_invalid');
  }

  if (errors.size > 0 || sku === undefined) {
    return { state: 'invalid', input: null, errors: [...errors.values()] };
  }
  const parsed = ItemImportRowInput.safeParse({ sku, given });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = (issue.path[0] === 'given' ? issue.path[1] : issue.path[0]) as string;
      add(importField(field), issue.code === 'too_big' ? 'too_long' : 'invalid');
    }
    return { state: 'invalid', input: null, errors: [...errors.values()] };
  }
  return { state: 'valid', input: parsed.data, errors: [] };
}

/** The file field of a command input's key: an item's `name` is the file's `itemName`. */
function importField(key: string): ItemImportField {
  if (key === 'name') return 'itemName';
  const fields: readonly string[] = [
    'sku',
    'category',
    'hsn',
    'unit',
    'purchaseUnit',
    'purchaseUnitFactor',
    'isSerialTracked',
    'isDcr',
    'almmRef',
    'warrantyMonths',
    'supplierWarrantyMonths',
    'barcode',
    'serialPattern',
  ];
  return (fields.includes(key) ? key : 'sku') as ItemImportField;
}

/** What a row becomes: the input of the command that makes or changes its item. */
export type ItemRowPlan =
  | { kind: 'create'; input: CreateItemInput }
  | { kind: 'update'; input: UpdateItemInput }
  | { kind: 'refused'; errors: ImportRowErrorDto[] };

/**
 * The command a checked row runs, against the catalogue as it stands: a new code makes an item
 * from the fields given (its name, category, HSN code and unit required, a category whose
 * required details only the item sheet takes refused); a code the catalogue has changes that item,
 * each field given over what it has (an item no longer sold is refused). The whole is checked
 * through the command's own input, and each issue is the row's finding on its field.
 */
export function planItemRow(
  row: ItemImportRowInput,
  existing: ExistingItem | undefined,
): ItemRowPlan {
  const g = row.given;
  if (existing?.archivedAt !== undefined && existing.archivedAt !== null) {
    return { kind: 'refused', errors: [{ field: 'sku', code: 'item_archived' }] };
  }
  if (existing === undefined) {
    const missing = (['name', 'category', 'hsn', 'unit'] as const).filter(
      (k) => g[k] === undefined,
    );
    if (missing.length > 0) {
      return {
        kind: 'refused',
        errors: missing.map((k) => ({ field: importField(k), code: 'required' })),
      };
    }
    const candidate = {
      sku: row.sku,
      name: g.name,
      category: g.category,
      hsn: g.hsn,
      unit: g.unit,
      isSerialTracked: g.isSerialTracked ?? false,
      isDcr: g.isDcr ?? false,
      ...(g.almmRef === undefined ? {} : { almmRef: g.almmRef }),
      specs: {},
      warrantyMonths: g.warrantyMonths ?? null,
      supplierWarrantyMonths: g.supplierWarrantyMonths ?? null,
      barcode: g.barcode ?? null,
      purchaseUnit: g.purchaseUnit ?? null,
      purchaseUnitFactor: g.purchaseUnitFactor ?? null,
      serialPattern: g.serialPattern ?? null,
      isStocked: true,
    };
    const parsed = CreateItemInput.safeParse(candidate);
    return parsed.success
      ? { kind: 'create', input: candidate as CreateItemInput }
      : { kind: 'refused', errors: issueErrors(parsed.error.issues) };
  }
  const almmRef = g.almmRef ?? existing.almmRef;
  const candidate = {
    itemId: existing.id,
    sku: row.sku,
    name: g.name ?? existing.name,
    category: g.category ?? existing.category,
    hsn: g.hsn ?? existing.hsn,
    unit: g.unit ?? existing.unit,
    isSerialTracked: g.isSerialTracked ?? existing.isSerialTracked,
    isDcr: g.isDcr ?? existing.isDcr,
    ...(almmRef === null ? {} : { almmRef }),
    specs: existing.specsJson as Record<string, unknown>,
    warrantyMonths: g.warrantyMonths ?? existing.warrantyMonths,
    supplierWarrantyMonths: g.supplierWarrantyMonths ?? existing.supplierWarrantyMonths,
    barcode: g.barcode ?? existing.barcode,
    purchaseUnit: g.purchaseUnit ?? existing.purchaseUnit,
    purchaseUnitFactor: g.purchaseUnitFactor ?? existing.purchaseUnitFactor,
    serialPattern: g.serialPattern ?? existing.serialPattern,
    isStocked: existing.isStocked,
  };
  const parsed = UpdateItemInput.safeParse(candidate);
  return parsed.success
    ? { kind: 'update', input: candidate as UpdateItemInput }
    : { kind: 'refused', errors: issueErrors(parsed.error.issues) };
}

/** The command input's issues as the row's findings, one per field. */
function issueErrors(
  issues: readonly { path: readonly PropertyKey[]; code: string }[],
): ImportRowErrorDto[] {
  const errors = new Map<string, ImportRowErrorDto>();
  for (const issue of issues) {
    const key = String(issue.path[0]);
    // The specifications of the category: only the item sheet asks for them.
    const error: ImportRowErrorDto =
      key === 'specs'
        ? { field: 'category', code: 'item_details_needed' }
        : key === 'serialPattern'
          ? { field: 'serialPattern', code: 'serial_pattern_invalid' }
          : { field: importField(key), code: issue.code === 'too_big' ? 'too_long' : 'invalid' };
    if (!errors.has(error.field)) errors.set(error.field, error);
  }
  return [...errors.values()];
}
