import type {
  AccountImportField,
  ImplementedImportKind,
  ImportDedupeMatch,
  ImportField,
  ImportJobDto,
  ImportJobState,
  ImportKind,
  ImportMapping,
  ImportRowDto,
  ImportRowErrorCode,
  ImportRowState,
  ImportTemplateDto,
  LeadImportField,
  PinCodeImportField,
} from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';

// The import screen's own logic (docs/design/backend-weeks-3-5.md §8): which step a job is at,
// the column matching form, the rows' findings and the progress line. Only types come from the
// contracts, so no schema reaches the browser; `import-wizard.test.ts` keeps the lists equal.

/** How a job's state looks in the lists and on its page. */
export const JOB_STATE_TONE: Record<ImportJobState, StatusTone> = {
  uploaded: 'neutral',
  mapped: 'neutral',
  previewed: 'accent',
  committing: 'info',
  committed: 'success',
  rolled_back: 'neutral',
  failed: 'danger',
};

/** How a row's state looks in the check step's grid. */
export const ROW_STATE_TONE: Record<ImportRowState, StatusTone> = {
  pending: 'neutral',
  valid: 'success',
  invalid: 'danger',
  committed: 'success',
  skipped: 'warning',
  rolled_back: 'neutral',
};

/** Where a job opens: its own page, which shows the step it waits at. */
export function jobHref(job: Pick<ImportJobDto, 'entityId' | 'id'>) {
  return `/imports/${String(job.entityId)}/${job.id}` as const;
}

/** The lead fields a file column can fill, in the order the matching form offers them. */
export const LEAD_IMPORT_FIELDS = [
  'contactName',
  'phone',
  'accountName',
  'accountType',
  'preferredLanguage',
  'village',
  'siteType',
  'pin',
  'sourceCode',
  'pipelineKey',
] as const satisfies readonly LeadImportField[];

/** The customer fields of a customers file, in the order the matching form offers them. */
export const ACCOUNT_IMPORT_FIELDS = [
  'contactName',
  'phone',
  'company',
  'accountName',
  'accountType',
  'preferredLanguage',
  'village',
  'siteType',
  'pin',
] as const satisfies readonly AccountImportField[];

/** The post office fields of the India Post directory, in the order the form offers them. */
export const PIN_CODE_IMPORT_FIELDS = [
  'pin',
  'officeName',
  'taluk',
  'district',
  'state',
] as const satisfies readonly PinCodeImportField[];

/** The fields each kind of file offers. */
export const IMPORT_FIELDS_BY_KIND: Record<ImplementedImportKind, readonly ImportField[]> = {
  leads: LEAD_IMPORT_FIELDS,
  accounts: ACCOUNT_IMPORT_FIELDS,
  pin_codes: PIN_CODE_IMPORT_FIELDS,
};

/** A job's kind as the screens treat it; a kind not built yet reads as leads, which it cannot be. */
export function screenKind(kind: ImportKind): ImplementedImportKind {
  return kind === 'accounts' || kind === 'pin_codes' ? kind : 'leads';
}

/** Fields a value chosen on screen can fill for every row whose cell is empty. */
const DEFAULTABLE_FIELDS = [
  'pipelineKey',
  'accountType',
  'preferredLanguage',
  'siteType',
  'sourceCode',
] as const satisfies readonly LeadImportField[];
export type DefaultableField = (typeof DEFAULTABLE_FIELDS)[number];

/** The fields each kind lets a value fill for every row (`defaults` of its mapping). */
const DEFAULTABLE_BY_KIND: Record<ImplementedImportKind, readonly DefaultableField[]> = {
  leads: DEFAULTABLE_FIELDS,
  accounts: ['accountType', 'preferredLanguage', 'siteType'],
  pin_codes: [],
};

export function isDefaultable(
  field: ImportField,
  kind: ImplementedImportKind = 'leads',
): field is DefaultableField {
  return (DEFAULTABLE_BY_KIND[kind] as readonly string[]).includes(field);
}

/** The four steps of an import, as the step list names them. */
export const IMPORT_STEPS = ['upload', 'map', 'check', 'add'] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

/** The step a job in this state is waiting at; a finished job stays on the last step. */
export function stepOf(state: ImportJobState): ImportStep {
  switch (state) {
    case 'uploaded':
      return 'map';
    case 'mapped':
    case 'previewed':
      return 'check';
    default:
      return 'add';
  }
}

/** Whether a step is behind the job, is where it waits, or is still to come. */
export function stepStatus(step: ImportStep, state: ImportJobState): 'done' | 'current' | 'next' {
  const finished = state === 'committed' || state === 'rolled_back';
  const at = IMPORT_STEPS.indexOf(stepOf(state));
  const index = IMPORT_STEPS.indexOf(step);
  if (index < at || (finished && index === at)) return 'done';
  return index === at ? 'current' : 'next';
}

/** The matching form as the person fills it: a file column per field, and values for empty cells. */
export interface MappingDraft {
  columns: Partial<Record<ImportField, string>>;
  defaults: Partial<Record<DefaultableField, string>>;
}

const normalise = (text: string) => text.toLowerCase().replaceAll(/[^a-z0-9]/g, '');

/** Headings people give each field in their spreadsheets, compared without case or spaces. */
const HEADINGS: Record<ImportField, readonly string[]> = {
  contactName: ['name', 'customername', 'customer', 'contactname', 'contact', 'farmername'],
  phone: ['mobile', 'mobileno', 'mobilenumber', 'phone', 'phoneno', 'phonenumber', 'contactno'],
  accountName: ['farmname', 'businessname', 'firmname', 'company', 'accountname'],
  accountType: ['customertype', 'type', 'accounttype'],
  preferredLanguage: ['language', 'preferredlanguage'],
  village: ['village', 'town', 'villagetown', 'city', 'place'],
  siteType: ['sitetype', 'kindofsite'],
  pin: ['pin', 'pincode', 'postalcode'],
  sourceCode: ['source', 'leadsource'],
  pipelineKey: ['pipeline', 'lineofbusiness'],
  company: ['company', 'companycode', 'ourcompany', 'sellingcompany', 'brand'],
  officeName: ['officename', 'office', 'postoffice', 'poname'],
  taluk: ['taluk', 'taluka', 'tehsil', 'tahsil', 'subdistrict'],
  district: ['district', 'districtname'],
  state: ['state', 'statename', 'statecode'],
};

/**
 * A first guess at the matching from the file's headings. Each column is used for one field at
 * most, and a heading nobody recognises is left for the person to choose. In a customers file a
 * `Company` column names the company each customer deals with, so it is matched to that first.
 */
export function guessColumns(
  columns: readonly string[],
  kind: ImplementedImportKind = 'leads',
): MappingDraft['columns'] {
  const guessed: MappingDraft['columns'] = {};
  const used = new Set<string>();
  const fields = IMPORT_FIELDS_BY_KIND[kind];
  const order = kind === 'accounts' ? ['company' as const, ...fields] : fields;
  for (const field of order) {
    if (guessed[field] !== undefined) continue;
    const match = columns.find((c) => !used.has(c) && HEADINGS[field].includes(normalise(c)));
    if (match !== undefined) {
      guessed[field] = match;
      used.add(match);
    }
  }
  return guessed;
}

/** The form's starting point: the job's saved matching, or a guess from the headings. */
export function initialDraft(
  job: Pick<ImportJobDto, 'mapping' | 'columns'> & { kind?: ImportKind },
): MappingDraft {
  if (job.mapping !== null) return draftOf(job.mapping);
  return { columns: guessColumns(job.columns, screenKind(job.kind ?? 'leads')), defaults: {} };
}

function draftOf(mapping: ImportMapping): MappingDraft {
  const defaults: MappingDraft['defaults'] = {};
  for (const field of DEFAULTABLE_FIELDS) {
    const value = mapping.defaults[field];
    if (value !== undefined) defaults[field] = value;
  }
  return { columns: { ...mapping.columns }, defaults };
}

/** The draft with `field` read from `column`, or from no column when `column` is empty. */
export function withColumn(draft: MappingDraft, field: ImportField, column: string): MappingDraft {
  const columns = Object.fromEntries(
    Object.entries(draft.columns).filter(([f]) => f !== field),
  ) as MappingDraft['columns'];
  return { ...draft, columns: column === '' ? columns : { ...columns, [field]: column } };
}

/** The draft with `value` for rows whose `field` is empty, or no value when `value` is empty. */
export function withDefault(
  draft: MappingDraft,
  field: DefaultableField,
  value: string,
): MappingDraft {
  const defaults = Object.fromEntries(
    Object.entries(draft.defaults).filter(([f]) => f !== field),
  ) as MappingDraft['defaults'];
  return { ...draft, defaults: value === '' ? defaults : { ...defaults, [field]: value } };
}

/**
 * A saved layout applied to this file: a column the file lacks (the layout came from another
 * file) is left unmatched, for the person to choose.
 */
export function draftForFile(mapping: ImportMapping, columns: readonly string[]): MappingDraft {
  const draft = draftOf(mapping);
  return {
    ...draft,
    columns: Object.fromEntries(
      Object.entries(draft.columns).filter(([, column]) => columns.includes(column)),
    ),
  };
}

/** Why a field of the matching form cannot be sent yet, keyed to `imports.map.problems`. */
export type MappingProblem = 'columnRequired' | 'columnRepeated' | 'pipelineRequired';

/** The columns each kind must take from the file. */
const REQUIRED_COLUMNS: Record<ImplementedImportKind, readonly ImportField[]> = {
  leads: ['contactName', 'phone'],
  accounts: ['contactName', 'phone'],
  pin_codes: ['pin', 'officeName', 'district'],
};

/**
 * The problems the contract would refuse, found before anything is sent: the columns the kind
 * needs (a lead's or customer's name and phone; an office's PIN, name and district), a lead's
 * pipeline from a column or a value for every row, and a column filling one field only.
 */
export function mappingProblems(
  draft: MappingDraft,
  kind: ImplementedImportKind = 'leads',
): Partial<Record<ImportField, MappingProblem>> {
  const problems: Partial<Record<ImportField, MappingProblem>> = {};
  const seen = new Map<string, number>();
  for (const column of Object.values(draft.columns)) seen.set(column, (seen.get(column) ?? 0) + 1);
  for (const field of IMPORT_FIELDS_BY_KIND[kind]) {
    const column = draft.columns[field];
    if (column !== undefined && (seen.get(column) ?? 0) > 1) problems[field] = 'columnRepeated';
  }
  for (const field of REQUIRED_COLUMNS[kind]) {
    if (draft.columns[field] === undefined) problems[field] = 'columnRequired';
  }
  if (
    kind === 'leads' &&
    draft.columns.pipelineKey === undefined &&
    draft.defaults.pipelineKey === undefined
  ) {
    problems.pipelineKey = 'pipelineRequired';
  }
  return problems;
}

/** The matching as `imports.job.map` takes it, with no empty entries and only the kind's fields. */
export function mappingOf(
  draft: MappingDraft,
  kind: ImplementedImportKind = 'leads',
): {
  columns: Partial<Record<ImportField, string>>;
  defaults: Partial<Record<DefaultableField, string>>;
} {
  const columns: Partial<Record<ImportField, string>> = {};
  for (const field of IMPORT_FIELDS_BY_KIND[kind]) {
    const column = draft.columns[field];
    if (column !== undefined && column !== '') columns[field] = column;
  }
  const defaults: Partial<Record<DefaultableField, string>> = {};
  for (const field of DEFAULTABLE_BY_KIND[kind]) {
    // A column wins over a value for every row only where the cell is filled; both may be given.
    const value = draft.defaults[field];
    if (value !== undefined && value !== '') defaults[field] = value;
  }
  return { columns, defaults };
}

function sameMapping(a: ReturnType<typeof mappingOf>, b: ReturnType<typeof mappingOf>): boolean {
  const same = (x: Record<string, string>, y: Record<string, string>) => {
    const keys = Object.keys(x);
    return keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
  };
  return same(a.columns, b.columns) && same(a.defaults, b.defaults);
}

/**
 * The `imports.job.map` input: a saved layout used as it stands is sent by its id, so the job
 * records which layout it followed; anything else is sent as a matching, saved under a new name
 * when one is given.
 */
export function buildMapInput(args: {
  entityId: number;
  jobId: string;
  draft: MappingDraft;
  template: ImportTemplateDto | undefined;
  saveAs: string;
  kind?: ImplementedImportKind;
}): Record<string, unknown> {
  const kind = args.kind ?? 'leads';
  const mapping = mappingOf(args.draft, kind);
  const ref = { entityId: args.entityId, jobId: args.jobId };
  const name = args.saveAs.trim();
  if (
    args.template !== undefined &&
    name === '' &&
    sameMapping(mapping, mappingOf(draftOf(args.template.mapping), kind))
  ) {
    return { ...ref, templateId: args.template.id };
  }
  return { ...ref, mapping, ...(name === '' ? {} : { saveAsTemplate: { name } }) };
}

/** Which rows the check step lists; the choices map to the rows query's state filter. */
export const ROW_VIEWS = ['attention', 'valid', 'skipped', 'committed', 'all'] as const;
export type RowView = (typeof ROW_VIEWS)[number];

export function rowStateOf(view: RowView): ImportRowState | undefined {
  switch (view) {
    case 'attention':
      return 'invalid';
    case 'all':
      return undefined;
    default:
      return view;
  }
}

/** The rows worth looking at first: where adding stopped, the rows to correct, or all of them. */
export function initialRowView(
  job: Pick<ImportJobDto, 'state' | 'invalidRows' | 'committedRows'>,
): RowView {
  if (job.state === 'failed') return 'valid';
  if (job.state === 'committed') return 'committed';
  if (job.state === 'rolled_back') return 'all';
  return job.invalidRows > 0 ? 'attention' : 'all';
}

/** One thing to say about a row, in the order the grid lists them. */
export type RowFinding =
  | { kind: 'error'; field: ImportField | 'row'; code: ImportRowErrorCode }
  | { kind: 'sameAsRow'; rowNo: number; site?: FoldedSite }
  | { kind: 'linked'; name: string | undefined; site?: FoldedSite }
  | { kind: 'customer'; name: string | undefined; matchedBy: ImportDedupeMatch };

/** What became of a repeated or linked customers row's site (`ImportDedupeDto.site`). */
export type FoldedSite = NonNullable<NonNullable<ImportRowDto['dedupe']>['site']>;

/**
 * A row's findings: what is wrong with it, then the customer a customers row is added to, then
 * who it may already be (the customer it is added to is not suggested again).
 */
export function rowFindings(
  row: Pick<ImportRowDto, 'errors' | 'dedupe'>,
  customers: Readonly<Record<string, string>>,
): RowFinding[] {
  const findings: RowFinding[] = row.errors.map((e) => ({
    kind: 'error' as const,
    field: e.field,
    code: e.code,
  }));
  if (row.dedupe !== null) {
    if (row.dedupe.inFileRowNo !== null) {
      const site = row.dedupe.site;
      findings.push({
        kind: 'sameAsRow',
        rowNo: row.dedupe.inFileRowNo,
        ...(site === undefined ? {} : { site }),
      });
    }
    const seen = new Set<string>();
    const linkedTo = row.dedupe.linkedTo;
    if (linkedTo !== undefined) {
      seen.add(linkedTo);
      const site = row.dedupe.site;
      findings.push({
        kind: 'linked',
        name: customers[linkedTo],
        ...(site === undefined ? {} : { site }),
      });
    }
    for (const match of row.dedupe.existing) {
      if (seen.has(match.accountId)) continue;
      seen.add(match.accountId);
      findings.push({
        kind: 'customer',
        name: customers[match.accountId],
        matchedBy: match.matchedBy,
      });
    }
  }
  return findings;
}

/** What the file said for one field of a row, through the job's matching; empty when unmatched. */
export function rowValue(
  row: Pick<ImportRowDto, 'raw'>,
  mapping: ImportMapping | null,
  field: ImportField,
): string {
  const column = mapping?.columns[field];
  return column === undefined ? '' : (row.raw[column] ?? '').trim();
}

/** How far a commit has come: the rows added out of the rows ready to add. */
export function commitProgress(job: Pick<ImportJobDto, 'validRows' | 'committedRows'>): {
  done: number;
  total: number;
  percent: number;
} {
  const total = job.validRows;
  const done = Math.min(job.committedRows, total);
  return { done, total, percent: total === 0 ? 100 : Math.floor((done * 100) / total) };
}

/** The job is still adding rows: the screen keeps asking for its progress. */
export function isCommitting(state: ImportJobState): boolean {
  return state === 'committing';
}

/** How long adding may show no progress before the screen offers to carry on. */
export const STALL_AFTER_MS = 90_000;

/** No progress since `lastChangeAt`, for longer than a batch takes: offer to carry on. */
export function isStalled(lastChangeAt: number, now: number): boolean {
  return now - lastChangeAt > STALL_AFTER_MS;
}

/** The rows of the batch that failed, counted in ready rows from 1, for the failure sentence. */
export function failedBatchRange(
  failedBatch: number,
  batchSize: number,
): { from: number; to: number } {
  return { from: (failedBatch - 1) * batchSize + 1, to: failedBatch * batchSize };
}

/** A job can be undone once, after its leads went in or adding stopped. */
export function canRollBack(state: ImportJobState): boolean {
  return state === 'committed' || state === 'failed';
}

/** The limits of one file, as the upload form states them and checks them first. */
export interface UploadLimits {
  maxFileBytes: number;
  maxRows: number;
}

const ACCEPTED = /\.(csv|xlsx)$/i;

/**
 * A file the upload would refuse anyway, found before its bytes are sent: empty, too big, or not
 * a CSV or .xlsx file by its name. The answer is an `errors.*` key; the server checks again.
 */
export function fileProblem(
  file: { name: string; size: number },
  limits: UploadLimits,
): 'import_file_empty' | 'import_file_too_large' | 'import_file_type' | undefined {
  if (file.size === 0) return 'import_file_empty';
  if (file.size > limits.maxFileBytes) return 'import_file_too_large';
  if (!ACCEPTED.test(file.name)) return 'import_file_type';
  return undefined;
}

/** The limits in the words the upload form uses: whole megabytes and rows grouped the Indian way. */
export function limitsInWords(limits: UploadLimits): { megabytes: number; rows: string } {
  return {
    megabytes: Math.floor(limits.maxFileBytes / (1024 * 1024)),
    rows: new Intl.NumberFormat('en-IN').format(limits.maxRows),
  };
}

export { formatCount } from './format';

/** A file's size in words: kilobytes below one megabyte, else megabytes to one place. */
export function fileSize(bytes: number): { unit: 'kb' | 'mb'; value: string } {
  if (bytes < 1024 * 1024)
    return { unit: 'kb', value: String(Math.max(1, Math.ceil(bytes / 1024))) };
  return { unit: 'mb', value: (bytes / (1024 * 1024)).toFixed(1) };
}

/** The types an import file is uploaded as: a CSV file or an Excel workbook. */
export const IMPORT_CONTENT_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

/**
 * The type an import file is uploaded as, known by its name: a computer with Excel calls a CSV
 * file `application/vnd.ms-excel`, and some browsers give a file no type at all. Anything else
 * keeps the browser's guess, which the uploader then refuses.
 */
export function importContentType(file: { name: string; type: string }): string {
  if (/\.csv$/i.test(file.name)) return IMPORT_CONTENT_TYPES[0];
  if (/\.xlsx$/i.test(file.name)) return IMPORT_CONTENT_TYPES[1];
  return file.type;
}
