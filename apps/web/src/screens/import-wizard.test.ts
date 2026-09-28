import {
  IMPORT_LIMITS,
  ImportJobStateSchema,
  LeadImportFieldSchema,
  MapImportJobInput,
  newId,
  type ImportTemplateDto,
} from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildMapInput,
  canRollBack,
  commitProgress,
  draftForFile,
  failedBatchRange,
  fileProblem,
  fileSize,
  formatCount,
  guessColumns,
  initialDraft,
  initialRowView,
  isStalled,
  LEAD_IMPORT_FIELDS,
  limitsInWords,
  mappingProblems,
  rowFindings,
  rowStateOf,
  rowValue,
  STALL_AFTER_MS,
  stepOf,
  stepStatus,
  withColumn,
  withDefault,
  type MappingDraft,
} from './import-wizard';

const limits = { maxFileBytes: IMPORT_LIMITS.maxFileBytes, maxRows: IMPORT_LIMITS.maxRows };
const jobId = newId();

describe('the field list', () => {
  it('offers every lead field the contract can fill, once', () => {
    expect([...LEAD_IMPORT_FIELDS].sort()).toEqual([...LeadImportFieldSchema.options].sort());
  });
});

describe('stepOf and stepStatus', () => {
  it('puts every job state at a step', () => {
    const steps = Object.fromEntries(ImportJobStateSchema.options.map((s) => [s, stepOf(s)]));
    expect(steps).toEqual({
      uploaded: 'map',
      mapped: 'check',
      previewed: 'check',
      committing: 'add',
      committed: 'add',
      rolled_back: 'add',
      failed: 'add',
    });
  });

  it('marks the steps behind the job done and the rest still to come', () => {
    expect(stepStatus('upload', 'uploaded')).toBe('done');
    expect(stepStatus('map', 'uploaded')).toBe('current');
    expect(stepStatus('check', 'uploaded')).toBe('next');
    expect(stepStatus('check', 'previewed')).toBe('current');
    expect(stepStatus('add', 'committing')).toBe('current');
    expect(stepStatus('add', 'failed')).toBe('current');
    expect(stepStatus('add', 'committed')).toBe('done');
  });
});

describe('the matching form', () => {
  it('guesses columns from common headings, each column once', () => {
    expect(guessColumns(['Customer Name', 'Mobile No.', 'Village', 'PIN code', 'Notes'])).toEqual({
      contactName: 'Customer Name',
      phone: 'Mobile No.',
      village: 'Village',
      pin: 'PIN code',
    });
    expect(guessColumns(['Name', 'Name 2'])).toEqual({ contactName: 'Name' });
  });

  it('starts from the job’s saved matching when it has one', () => {
    const mapping = {
      columns: { contactName: 'A', phone: 'B' },
      defaults: { pipelineKey: 'farmer_pumps' },
    };
    expect(initialDraft({ mapping, columns: ['A', 'B'] })).toEqual({
      columns: { contactName: 'A', phone: 'B' },
      defaults: { pipelineKey: 'farmer_pumps' },
    });
    expect(initialDraft({ mapping: null, columns: ['Name', 'Phone'] })).toEqual({
      columns: { contactName: 'Name', phone: 'Phone' },
      defaults: {},
    });
  });

  it('changes one field of the form at a time, and clears it with an empty choice', () => {
    const start: MappingDraft = {
      columns: { contactName: 'A' },
      defaults: { siteType: 'rooftop' },
    };
    expect(withColumn(start, 'phone', 'B').columns).toEqual({ contactName: 'A', phone: 'B' });
    expect(withColumn(start, 'contactName', '').columns).toEqual({});
    expect(withDefault(start, 'siteType', 'borewell').defaults).toEqual({ siteType: 'borewell' });
    expect(withDefault(start, 'siteType', '').defaults).toEqual({});
    expect(start).toEqual({ columns: { contactName: 'A' }, defaults: { siteType: 'rooftop' } });
  });

  it('applies a saved layout, leaving unmatched a column this file lacks', () => {
    const mapping = {
      columns: { contactName: 'Name', phone: 'Mobile', village: 'Gaon' },
      defaults: { pipelineKey: 'farmer_pumps' },
    };
    expect(draftForFile(mapping, ['Name', 'Mobile'])).toEqual({
      columns: { contactName: 'Name', phone: 'Mobile' },
      defaults: { pipelineKey: 'farmer_pumps' },
    });
  });

  it('finds what the contract would refuse', () => {
    expect(mappingProblems({ columns: {}, defaults: {} })).toEqual({
      contactName: 'columnRequired',
      phone: 'columnRequired',
      pipelineKey: 'pipelineRequired',
    });
    expect(
      mappingProblems({
        columns: { contactName: 'A', phone: 'A' },
        defaults: { pipelineKey: 'farmer_pumps' },
      }),
    ).toEqual({ contactName: 'columnRepeated', phone: 'columnRepeated' });
    expect(
      mappingProblems({
        columns: { contactName: 'A', phone: 'B', pipelineKey: 'C' },
        defaults: {},
      }),
    ).toEqual({});
  });

  const draft: MappingDraft = {
    columns: { contactName: 'Name', phone: 'Mobile', village: '' },
    defaults: { pipelineKey: 'farmer_pumps', accountType: '' },
  };

  it('sends a matching the contract accepts, with no empty entries', () => {
    const input = buildMapInput({ entityId: 1, jobId, draft, template: undefined, saveAs: ' ' });
    expect(input).toEqual({
      entityId: 1,
      jobId,
      mapping: {
        columns: { contactName: 'Name', phone: 'Mobile' },
        defaults: { pipelineKey: 'farmer_pumps' },
      },
    });
    expect(MapImportJobInput.safeParse(input).success).toBe(true);
  });

  it('saves the matching under a new name when one is given', () => {
    const input = buildMapInput({
      entityId: 1,
      jobId,
      draft,
      template: undefined,
      saveAs: ' Fair leads ',
    });
    expect(input).toMatchObject({ saveAsTemplate: { name: 'Fair leads' } });
    expect(MapImportJobInput.safeParse(input).success).toBe(true);
  });

  it('sends a saved layout by its id only when it is used as it stands', () => {
    const template: ImportTemplateDto = {
      id: newId(),
      entityId: 1,
      kind: 'leads',
      name: 'Fair leads',
      mapping: {
        columns: { contactName: 'Name', phone: 'Mobile' },
        defaults: { pipelineKey: 'farmer_pumps' },
      },
      updatedAt: new Date().toISOString(),
    };
    const same = buildMapInput({ entityId: 1, jobId, draft, template, saveAs: '' });
    expect(same).toEqual({ entityId: 1, jobId, templateId: template.id });
    expect(MapImportJobInput.safeParse(same).success).toBe(true);
    const changed = buildMapInput({
      entityId: 1,
      jobId,
      draft: { ...draft, columns: { ...draft.columns, village: 'Village' } },
      template,
      saveAs: '',
    });
    expect(changed).toHaveProperty('mapping');
    expect(changed).not.toHaveProperty('templateId');
  });
});

describe('the rows of the check step', () => {
  it('maps each view to the rows query’s filter', () => {
    expect(rowStateOf('attention')).toBe('invalid');
    expect(rowStateOf('all')).toBeUndefined();
    expect(rowStateOf('skipped')).toBe('skipped');
  });

  it('opens on the rows worth looking at first', () => {
    const job = { invalidRows: 0, committedRows: 0 };
    expect(initialRowView({ ...job, state: 'previewed', invalidRows: 2 })).toBe('attention');
    expect(initialRowView({ ...job, state: 'previewed' })).toBe('all');
    expect(initialRowView({ ...job, state: 'failed' })).toBe('valid');
    expect(initialRowView({ ...job, state: 'committed' })).toBe('committed');
    expect(initialRowView({ ...job, state: 'rolled_back' })).toBe('all');
  });

  it('lists what is wrong, then who the row may already be', () => {
    const accountId = newId();
    const unseen = newId();
    const findings = rowFindings(
      {
        errors: [{ field: 'phone', code: 'phone_invalid' }],
        dedupe: {
          inFileRowNo: 2,
          existing: [
            { accountId, contactId: newId(), matchedBy: 'phone' },
            { accountId, contactId: newId(), matchedBy: 'name_village' },
            { accountId: unseen, contactId: newId(), matchedBy: 'name_village' },
          ],
        },
      },
      { [accountId]: 'Shree Farm' },
    );
    expect(findings).toEqual([
      { kind: 'error', field: 'phone', code: 'phone_invalid' },
      { kind: 'sameAsRow', rowNo: 2 },
      { kind: 'customer', name: 'Shree Farm', matchedBy: 'phone' },
      { kind: 'customer', name: undefined, matchedBy: 'name_village' },
    ]);
    expect(rowFindings({ errors: [], dedupe: null }, {})).toEqual([]);
  });

  it('reads a field through the job’s matching', () => {
    const mapping = { columns: { contactName: 'Name' }, defaults: {} };
    expect(rowValue({ raw: { Name: ' Gopal ' } }, mapping, 'contactName')).toBe('Gopal');
    expect(rowValue({ raw: { Name: 'Gopal' } }, mapping, 'phone')).toBe('');
    expect(rowValue({ raw: {} }, null, 'contactName')).toBe('');
  });
});

describe('adding the rows', () => {
  it('counts progress against the rows ready to add', () => {
    expect(commitProgress({ validRows: 1200, committedRows: 500 })).toEqual({
      done: 500,
      total: 1200,
      percent: 41,
    });
    expect(commitProgress({ validRows: 0, committedRows: 0 }).percent).toBe(100);
  });

  it('offers to carry on only after a long wait with no progress', () => {
    expect(isStalled(0, STALL_AFTER_MS)).toBe(false);
    expect(isStalled(0, STALL_AFTER_MS + 1)).toBe(true);
  });

  it('names the rows of the batch that failed', () => {
    expect(failedBatchRange(1, 500)).toEqual({ from: 1, to: 500 });
    expect(failedBatchRange(3, 500)).toEqual({ from: 1001, to: 1500 });
  });

  it('allows an undo only after the leads went in or adding stopped', () => {
    const allowed = ImportJobStateSchema.options.filter(canRollBack);
    expect(allowed).toEqual(['committed', 'failed']);
  });
});

describe('the upload form', () => {
  it('refuses what the upload would refuse, before sending it', () => {
    expect(fileProblem({ name: 'leads.csv', size: 0 }, limits)).toBe('import_file_empty');
    expect(fileProblem({ name: 'leads.xlsx', size: limits.maxFileBytes + 1 }, limits)).toBe(
      'import_file_too_large',
    );
    expect(fileProblem({ name: 'leads.xls', size: 10 }, limits)).toBe('import_file_type');
    expect(fileProblem({ name: 'LEADS.XLSX', size: 10 }, limits)).toBeUndefined();
    expect(fileProblem({ name: 'leads.csv', size: limits.maxFileBytes }, limits)).toBeUndefined();
  });

  it('states the limits in words', () => {
    expect(limitsInWords(limits)).toEqual({ megabytes: 10, rows: '50,000' });
    expect(formatCount(150000)).toBe('1,50,000');
  });

  it('writes a file size people read', () => {
    expect(fileSize(10)).toEqual({ unit: 'kb', value: '1' });
    expect(fileSize(2048)).toEqual({ unit: 'kb', value: '2' });
    expect(fileSize(3.5 * 1024 * 1024)).toEqual({ unit: 'mb', value: '3.5' });
  });
});
