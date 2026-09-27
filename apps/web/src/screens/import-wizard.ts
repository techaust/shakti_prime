import type {
  ImportJobDto,
  ImportJobState,
  ImportMapping,
  ImportRowDto,
  ImportRowErrorCode,
  ImportRowState,
  ImportTemplateDto,
  LeadImportField,
} from '@shakti/contracts';

// The import screen's own logic (docs/design/backend-weeks-3-5.md §8): which step a job is at,
// the column matching form, the rows' findings and the progress line. Only types come from the
// contracts, so no schema reaches the browser; `import-wizard.test.ts` keeps the lists equal.

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

/** Fields a value chosen on screen can fill for every row whose cell is empty. */
export const DEFAULTABLE_FIELDS = [
  'pipelineKey',
  'accountType',
  'preferredLanguage',
  'siteType',
  'sourceCode',
] as const satisfies readonly LeadImportField[];
export type DefaultableField = (typeof DEFAULTABLE_FIELDS)[number];

export function isDefaultable(field: LeadImportField): field is DefaultableField {
  return (DEFAULTABLE_FIELDS as readonly string[]).includes(field);
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
  columns: Partial<Record<LeadImportField, string>>;
  defaults: Partial<Record<DefaultableField, string>>;
}

const normalise = (text: string) => text.toLowerCase().replaceAll(/[^a-z0-9]/g, '');

/** Headings people give each field in their spreadsheets, compared without case or spaces. */
const HEADINGS: Record<LeadImportField, readonly string[]> = {
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
};

/**
 * A first guess at the matching from the file's headings. Each column is used for one field at
 * most, and a heading nobody recognises is left for the person to choose.
 */
export function guessColumns(columns: readonly string[]): MappingDraft['columns'] {
  const guessed: MappingDraft['columns'] = {};
  const used = new Set<string>();
  for (const field of LEAD_IMPORT_FIELDS) {
    const match = columns.find((c) => !used.has(c) && HEADINGS[field].includes(normalise(c)));
    if (match !== undefined) {
      guessed[field] = match;
      used.add(match);
    }
  }
  return guessed;
}

/** The form's starting point: the job's saved matching, or a guess from the headings. */
export function initialDraft(job: Pick<ImportJobDto, 'mapping' | 'columns'>): MappingDraft {
  if (job.mapping !== null) return draftOf(job.mapping);
  return { columns: guessColumns(job.columns), defaults: {} };
}

export function draftOf(mapping: ImportMapping): MappingDraft {
  const defaults: MappingDraft['defaults'] = {};
  for (const field of DEFAULTABLE_FIELDS) {
    const value = mapping.defaults[field];
    if (value !== undefined) defaults[field] = value;
  }
  return { columns: { ...mapping.columns }, defaults };
}

/** Why a field of the matching form cannot be sent yet, keyed to `imports.map.problems`. */
export type MappingProblem = 'columnRequired' | 'columnRepeated' | 'pipelineRequired';

/**
 * The problems the contract would refuse, found before anything is sent: the name and phone
 * columns are required, a pipeline comes from a column or a value for every row, and a column
 * fills one field only.
 */
export function mappingProblems(
  draft: MappingDraft,
): Partial<Record<LeadImportField, MappingProblem>> {
  const problems: Partial<Record<LeadImportField, MappingProblem>> = {};
  const seen = new Map<string, number>();
  for (const column of Object.values(draft.columns)) {
    if (column !== undefined) seen.set(column, (seen.get(column) ?? 0) + 1);
  }
  for (const field of LEAD_IMPORT_FIELDS) {
    const column = draft.columns[field];
    if (column !== undefined && (seen.get(column) ?? 0) > 1) problems[field] = 'columnRepeated';
  }
  if (draft.columns.contactName === undefined) problems.contactName = 'columnRequired';
  if (draft.columns.phone === undefined) problems.phone = 'columnRequired';
  if (draft.columns.pipelineKey === undefined && draft.defaults.pipelineKey === undefined) {
    problems.pipelineKey = 'pipelineRequired';
  }
  return problems;
}

/** The matching as `imports.job.map` takes it, with no empty entries. */
export function mappingOf(draft: MappingDraft): {
  columns: Partial<Record<LeadImportField, string>>;
  defaults: Partial<Record<DefaultableField, string>>;
} {
  const columns: Partial<Record<LeadImportField, string>> = {};
  for (const field of LEAD_IMPORT_FIELDS) {
    const column = draft.columns[field];
    if (column !== undefined && column !== '') columns[field] = column;
  }
  const defaults: Partial<Record<DefaultableField, string>> = {};
  for (const field of DEFAULTABLE_FIELDS) {
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
}): Record<string, unknown> {
  const mapping = mappingOf(args.draft);
  const ref = { entityId: args.entityId, jobId: args.jobId };
  const name = args.saveAs.trim();
  if (
    args.template !== undefined &&
    name === '' &&
    sameMapping(mapping, mappingOf(draftOf(args.template.mapping)))
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
  | { kind: 'error'; field: LeadImportField | 'row'; code: ImportRowErrorCode }
  | { kind: 'sameAsRow'; rowNo: number }
  | { kind: 'customer'; name: string | undefined };

/** A row's findings: what is wrong with it, then who it may already be. */
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
      findings.push({ kind: 'sameAsRow', rowNo: row.dedupe.inFileRowNo });
    }
    const seen = new Set<string>();
    for (const match of row.dedupe.existing) {
      if (seen.has(match.accountId)) continue;
      seen.add(match.accountId);
      findings.push({ kind: 'customer', name: customers[match.accountId] });
    }
  }
  return findings;
}

/** What the file said for one field of a row, through the job's matching; empty when unmatched. */
export function rowValue(
  row: Pick<ImportRowDto, 'raw'>,
  mapping: ImportMapping | null,
  field: LeadImportField,
): string {
  const column = mapping?.columns[field];
  return column === undefined ? '' : (row.raw[column] ?? '').trim();
}

/** How far a commit has come: the leads added out of the rows ready to add. */
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

/** A count as the screens write it, grouped the Indian way (1,00,000). */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

/** A file's size in words: kilobytes below one megabyte, else megabytes to one place. */
export function fileSize(bytes: number): { unit: 'kb' | 'mb'; value: string } {
  if (bytes < 1024 * 1024)
    return { unit: 'kb', value: String(Math.max(1, Math.ceil(bytes / 1024))) };
  return { unit: 'mb', value: (bytes / (1024 * 1024)).toFixed(1) };
}
