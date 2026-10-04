import {
  AccountImportRowInput,
  MORE_SITES_MAX,
  type AccountImportField,
  type AccountImportSiteInput,
  type AccountImportMapping,
  type ImportRowErrorDto,
} from '@shakti/contracts';
import { enumWord, matchKey } from './leads';

/** What the preview found for one row of a customers file. */
export type AccountRowCheck =
  | { state: 'valid'; input: AccountImportRowInput; phone: string; errors: [] }
  | { state: 'invalid'; input: null; phone: null; errors: ImportRowErrorDto[] };

/**
 * The companies a row may name, by what a person would write: each company's code and its brand
 * and legal names, compared as `matchKey` compares them. Only the companies of the request.
 */
export type CompanyNames = ReadonlyMap<string, number>;

export function companyNames(
  companies: readonly { id: number; code: string; brandName: string; legalName: string }[],
): CompanyNames {
  const names = new Map<string, number>();
  for (const c of companies) {
    for (const name of [c.code, c.brandName, c.legalName]) {
      const key = matchKey(name);
      if (key !== '') names.set(key, c.id);
    }
  }
  return names;
}

const LANGUAGES: Readonly<Record<string, string>> = {
  hinglish: 'hinglish',
  hindi: 'hinglish',
  en: 'en',
  english: 'en',
};

/** Where an input path points among the fields a file can fill. */
const FIELD_OF_PATH: Readonly<Record<string, AccountImportField>> = {
  'contact.name': 'contactName',
  'contact.phone': 'phone',
  'contact.preferredLanguage': 'preferredLanguage',
  'account.type': 'accountType',
  'account.name': 'accountName',
  'site.type': 'siteType',
  'site.village': 'village',
  'site.pin': 'pin',
  entityIds: 'company',
};

function valueAt(candidate: Record<string, unknown>, path: readonly PropertyKey[]): unknown {
  let at: unknown = candidate;
  for (const key of path) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Record<PropertyKey, unknown>)[key];
  }
  return at;
}

/**
 * Checks one row of a customers file (docs/design/phase1.md §6.3) and answers the customer it
 * becomes, or its findings, one per field. A blank company cell means the job's own company; a
 * company the request does not act for is refused. A site is added when the row gives a village.
 */
export function checkAccountRow(
  raw: Readonly<Record<string, string>>,
  mapping: AccountImportMapping,
  jobEntityId: number,
  companies: CompanyNames,
): AccountRowCheck {
  const cell = (field: AccountImportField): string | undefined => {
    const column = mapping.columns[field];
    const value = column === undefined ? '' : (raw[column] ?? '').trim();
    return value === '' ? undefined : value;
  };
  const errors = new Map<string, ImportRowErrorDto>();
  const add = (error: ImportRowErrorDto) => {
    if (!errors.has(error.field)) errors.set(error.field, error);
  };

  const company = cell('company');
  const entityId = company === undefined ? jobEntityId : companies.get(matchKey(company));
  if (entityId === undefined) add({ field: 'company', code: 'company_unknown' });

  const defaults = mapping.defaults;
  const accountType = cell('accountType');
  const language = cell('preferredLanguage');
  const siteType = cell('siteType');
  const village = cell('village');
  const pin = cell('pin');
  const accountName = cell('accountName');
  const candidate: Record<string, unknown> = {
    entityIds: [entityId ?? jobEntityId],
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
  };
  if (village !== undefined || pin !== undefined) {
    candidate.site = {
      type: siteType === undefined ? defaults.siteType : enumWord(siteType),
      village,
      ...(pin === undefined ? {} : { pin }),
    };
  }

  const parsed = AccountImportRowInput.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = FIELD_OF_PATH[issue.path.slice(0, 2).join('.')] ?? 'row';
      if (valueAt(candidate, issue.path) === undefined) add({ field, code: 'required' });
      else if (field === 'phone') add({ field, code: 'phone_invalid' });
      else if (issue.code === 'too_big') add({ field, code: 'too_long' });
      else add({ field, code: 'invalid' });
    }
  }
  if (!parsed.success || errors.size > 0) {
    return { state: 'invalid', input: null, phone: null, errors: [...errors.values()] };
  }
  return { state: 'valid', input: parsed.data, phone: parsed.data.contact.phone, errors: [] };
}

/** What the fold of a customers file found: see `foldAccountRows`. */
export interface FoldedAccountRows {
  /** Each first row's companies, its own first, then those later rows add. */
  companies: Map<number, number[]>;
  /** Each repeat's first row. */
  repeats: Map<number, number>;
  /** The different sites later rows add to their first row's customer, in file order. */
  moreSites: Map<number, AccountImportSiteInput[]>;
  /** What became of each repeat's site, for a repeat that gives one. */
  sites: Map<number, 'added' | 'same' | 'too_many'>;
}

/** A site as the fold compares it: its type, its village through `matchKey`, and its PIN. */
function siteKey(site: AccountImportSiteInput): string {
  return `${site.type}\u0000${matchKey(site.village)}\u0000${site.pin ?? ''}`;
}

/**
 * Rows of one customer (the same mobile number) fold into the first of them: it keeps its place
 * and takes on the companies of every later one, in file order, and each later row points back at
 * it and is not imported again. A later row's site that differs from the sites the customer has
 * so far (by type, village and PIN) is added to it too, up to `MORE_SITES_MAX`; the preview says
 * of each repeat whether its site was added, was already there, or was one too many.
 */
export function foldAccountRows(
  rows: readonly { rowNo: number; check: AccountRowCheck }[],
): FoldedAccountRows {
  const firstByPhone = new Map<string, number>();
  const folded: FoldedAccountRows = {
    companies: new Map(),
    repeats: new Map(),
    moreSites: new Map(),
    sites: new Map(),
  };
  const siteKeys = new Map<number, Set<string>>();
  for (const { rowNo, check } of rows) {
    if (check.state !== 'valid') continue;
    const first = firstByPhone.get(check.phone);
    if (first === undefined) {
      firstByPhone.set(check.phone, rowNo);
      folded.companies.set(rowNo, [...check.input.entityIds]);
      siteKeys.set(
        rowNo,
        new Set(check.input.site === undefined ? [] : [siteKey(check.input.site)]),
      );
      continue;
    }
    folded.repeats.set(rowNo, first);
    const list = folded.companies.get(first) ?? [];
    for (const id of check.input.entityIds) if (!list.includes(id)) list.push(id);
    folded.companies.set(first, list);

    const site = check.input.site;
    if (site === undefined) continue;
    const known = siteKeys.get(first) ?? new Set<string>();
    const more = folded.moreSites.get(first) ?? [];
    if (known.has(siteKey(site))) {
      folded.sites.set(rowNo, 'same');
    } else if (more.length >= MORE_SITES_MAX) {
      folded.sites.set(rowNo, 'too_many');
    } else {
      known.add(siteKey(site));
      siteKeys.set(first, known);
      more.push(site);
      folded.moreSites.set(first, more);
      folded.sites.set(rowNo, 'added');
    }
  }
  return folded;
}
