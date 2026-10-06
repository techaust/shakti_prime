import { describe, expect, it } from 'vitest';
import { wordDocument } from '../../../e2e/support/docx';
import { checkOfficeFile, isOfficeType } from './office-check';

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('the vault’s Word and Excel files', () => {
  it('knows the two types it checks', () => {
    expect(isOfficeType(WORD)).toBe(true);
    expect(isOfficeType(WORKBOOK)).toBe(true);
    expect(isOfficeType('application/pdf')).toBe(false);
  });

  it('passes a Word document as a checked document', () => {
    expect(checkOfficeFile(wordDocument(['Pump care']), WORD)).toEqual({
      ok: true,
      sanitising: 'document_checked',
    });
  });

  it('refuses a Word document sent as a workbook, plain text, and an empty file', () => {
    const word = wordDocument(['Pump care']);
    expect(checkOfficeFile(word, WORKBOOK)).toEqual({ ok: false, reason: 'file_unreadable' });
    expect(checkOfficeFile(new TextEncoder().encode('not a document'), WORD)).toEqual({
      ok: false,
      reason: 'file_unreadable',
    });
    expect(checkOfficeFile(new Uint8Array(0), WORD)).toEqual({
      ok: false,
      reason: 'file_unreadable',
    });
  });
});
