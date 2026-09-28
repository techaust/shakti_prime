import {
  CreateLeadInput,
  type ImportRowErrorDto,
  type LeadImportField,
  type LeadImportMapping,
} from '@shakti/contracts';

/** What the preview found for one row of a leads file. */
export type LeadRowCheck =
  | { state: 'valid'; input: CreateLeadInput; phone: string; errors: [] }
  | { state: 'invalid'; input: null; phone: null; errors: ImportRowErrorDto[] };

/** The pipelines and lead sources a row may name, as the caller sees them. */
export interface LeadRowLookups {
  pipelineKeys: ReadonlySet<string>;
  sourceCodes: ReadonlySet<string>;
}

/** Lead sources a file row falls back to when it names none. */
export const IMPORT_SOURCE_CODE = 'import';

/** `Referral partner`, `referral-partner` and `REFERRAL_PARTNER` all read as `referral_partner`. */
export function enumWord(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

const LANGUAGES: Readonly<Record<string, string>> = {
  hinglish: 'hinglish',
  hindi: 'hinglish',
  en: 'en',
  english: 'en',
};

/** Where an input path points among the fields a file can fill. */
const FIELD_OF_PATH: Readonly<Record<string, LeadImportField>> = {
  'contact.name': 'contactName',
  'contact.phone': 'phone',
  'contact.preferredLanguage': 'preferredLanguage',
  'account.type': 'accountType',
  'account.name': 'accountName',
  'site.type': 'siteType',
  'site.village': 'village',
  'site.pin': 'pin',
  pipelineKey: 'pipelineKey',
  sourceCode: 'sourceCode',
};

/**
 * One file row as `crm.lead.create` input: each field from its mapped column, or the mapping's
 * default when the column is not mapped or the cell is blank. A site is added when the row
 * gives a village or a PIN; imports record no consent, which needs its own evidence.
 */
export function leadCandidate(
  raw: Readonly<Record<string, string>>,
  mapping: LeadImportMapping,
  entityId: number,
): Record<string, unknown> {
  const cell = (field: LeadImportField): string | undefined => {
    const column = mapping.columns[field];
    const value = column === undefined ? '' : (raw[column] ?? '').trim();
    return value === '' ? undefined : value;
  };
  const defaults = mapping.defaults;
  const accountType = cell('accountType');
  const language = cell('preferredLanguage');
  const siteType = cell('siteType');
  const village = cell('village');
  const pin = cell('pin');
  const accountName = cell('accountName');
  const candidate: Record<string, unknown> = {
    entityId,
    pipelineKey: cell('pipelineKey') ?? defaults.pipelineKey,
    contact: {
      name: cell('contactName'),
      phone: cell('phone'),
      preferredLanguage:
        language === undefined
          ? (defaults.preferredLanguage ?? 'hinglish')
          : (LANGUAGES[enumWord(language)] ?? language),
    },
    account: {
      type:
        accountType === undefined ? (defaults.accountType ?? 'household') : enumWord(accountType),
      ...(accountName === undefined ? {} : { name: accountName }),
    },
    sourceCode: cell('sourceCode') ?? defaults.sourceCode ?? IMPORT_SOURCE_CODE,
  };
  if (village !== undefined || pin !== undefined) {
    candidate.site = {
      type: siteType === undefined ? defaults.siteType : enumWord(siteType),
      village,
      ...(pin === undefined ? {} : { pin }),
    };
  }
  return candidate;
}

function valueAt(candidate: Record<string, unknown>, path: readonly PropertyKey[]): unknown {
  let at: unknown = candidate;
  for (const key of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<PropertyKey, unknown>)[key];
  }
  return at;
}

/**
 * Checks one row through the same input the command uses (design §8), plus the pipeline and
 * source lists, and answers the command input or the row's findings, one per field.
 */
export function checkLeadRow(
  raw: Readonly<Record<string, string>>,
  mapping: LeadImportMapping,
  entityId: number,
  lookups: LeadRowLookups,
): LeadRowCheck {
  const candidate = leadCandidate(raw, mapping, entityId);
  const errors = new Map<string, ImportRowErrorDto>();
  const add = (error: ImportRowErrorDto) => {
    if (!errors.has(error.field)) errors.set(error.field, error);
  };

  const parsed = CreateLeadInput.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = FIELD_OF_PATH[issue.path.join('.')] ?? 'row';
      if (valueAt(candidate, issue.path) === undefined) add({ field, code: 'required' });
      else if (field === 'phone') add({ field, code: 'phone_invalid' });
      else if (issue.code === 'too_big') add({ field, code: 'too_long' });
      else add({ field, code: 'invalid' });
    }
  }
  const pipelineKey = candidate.pipelineKey;
  if (typeof pipelineKey === 'string' && !lookups.pipelineKeys.has(pipelineKey)) {
    add({ field: 'pipelineKey', code: 'pipeline_unknown' });
  }
  const sourceCode = candidate.sourceCode;
  if (typeof sourceCode === 'string' && !lookups.sourceCodes.has(sourceCode)) {
    add({ field: 'sourceCode', code: 'source_unknown' });
  }

  if (!parsed.success || errors.size > 0) {
    return { state: 'invalid', input: null, phone: null, errors: [...errors.values()] };
  }
  const phone = parsed.data.contact?.phone ?? '';
  return { state: 'valid', input: parsed.data, phone, errors: [] };
}

/**
 * A name or village as the dedupe compares it: lower case, with spaces and punctuation dropped,
 * so `Ram Lal`, `RAMLAL` and `Ram-Lal.` agree. The database side applies the same rule
 * (`regexp_replace(lower(x), '[^a-z0-9]+', '', 'g')`); letters outside a to z drop out on both
 * sides, and a value with nothing left is not compared.
 */
export function matchKey(value: string | undefined | null): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** The name and village of a valid row, as compared keys; null when the row has no village. */
export function nameVillageKey(input: CreateLeadInput): { name: string; village: string } | null {
  const name = matchKey(input.contact?.name);
  const village = matchKey(input.site?.village);
  return name === '' || village === '' ? null : { name, village };
}

/**
 * Earlier rows of the same file with the same phone: the first keeps its place and each repeat
 * points back at it, so one person is not imported twice from one file.
 */
export function firstRowByPhone(
  rows: readonly { rowNo: number; phone: string | null }[],
): Map<number, number> {
  const first = new Map<string, number>();
  const repeats = new Map<number, number>();
  for (const { rowNo, phone } of rows) {
    if (phone === null) continue;
    const earlier = first.get(phone);
    if (earlier === undefined) first.set(phone, rowNo);
    else repeats.set(rowNo, earlier);
  }
  return repeats;
}
