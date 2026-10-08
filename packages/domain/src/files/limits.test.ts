import { IMPORT_LIMITS, MAX_UPLOAD_BYTES, newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { assertFileKey } from '../ports/file-store';
import { UPLOAD_LIMITS, uploadKey, uploadLimitProblem } from './limits';
import { UPLOADABLE_PURPOSES } from './purposes';

describe('upload limits', () => {
  it('has limits for every purpose a person may upload', () => {
    for (const purpose of UPLOADABLE_PURPOSES) expect(UPLOAD_LIMITS[purpose]).toBeDefined();
  });

  it('never allows more than the contract’s largest upload', () => {
    for (const limit of Object.values(UPLOAD_LIMITS)) {
      expect(limit.maxBytes).toBeLessThanOrEqual(MAX_UPLOAD_BYTES);
    }
  });

  it('takes a file of exactly the largest size and refuses one byte more', () => {
    const max = UPLOAD_LIMITS.entity_logo?.maxBytes ?? 0;
    expect(uploadLimitProblem('entity_logo', 'image/png', max)).toBeUndefined();
    expect(uploadLimitProblem('entity_logo', 'image/png', max + 1)).toBe('file_too_large');
  });

  it('refuses a type the purpose does not take', () => {
    expect(uploadLimitProblem('entity_logo', 'application/pdf', 10)).toBe('file_type_not_allowed');
    expect(uploadLimitProblem('quote_pdf', 'image/jpeg', 10)).toBe('file_type_not_allowed');
    expect(uploadLimitProblem('signed_quote', 'image/svg+xml', 10)).toBe('file_type_not_allowed');
    expect(uploadLimitProblem('import', 'application/pdf', 10)).toBe('file_type_not_allowed');
    expect(uploadLimitProblem('entity_logo', 'text/csv', 10)).toBe('file_type_not_allowed');
  });

  it('takes an import file as a CSV or a workbook up to the import limit', () => {
    const max = IMPORT_LIMITS.maxFileBytes;
    expect(uploadLimitProblem('import', 'text/csv', max)).toBeUndefined();
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(uploadLimitProblem('import', xlsx, 10)).toBeUndefined();
    expect(uploadLimitProblem('import', 'text/csv', max + 1)).toBe('file_too_large');
    expect(uploadKey(1, 'import', newId(), 'text/csv')).toMatch(/^1\/import\/[0-9a-f-]+\.csv$/);
  });

  it('takes a vault file as a photo, a PDF, a Word document or a workbook, never a CSV', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    for (const type of ['image/jpeg', 'application/pdf', docx, xlsx]) {
      expect(uploadLimitProblem('knowledge', type, 10)).toBeUndefined();
    }
    expect(uploadLimitProblem('knowledge', 'text/csv', 10)).toBe('file_type_not_allowed');
    expect(uploadLimitProblem('import', docx, 10)).toBe('file_type_not_allowed');
    expect(uploadKey(1, 'knowledge', newId(), docx)).toMatch(/^1\/knowledge\/[0-9a-f-]+\.docx$/);
  });

  it('makes a safe key per company, purpose and file', () => {
    const id = newId();
    const key = uploadKey(3, 'letterhead', id, 'image/webp');
    expect(key).toBe(`3/letterhead/${id}.webp`);
    expect(() => {
      assertFileKey(key);
    }).not.toThrow();
  });
});
