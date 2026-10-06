import { IMPORT_LIMITS, type FileRejectReason } from '@shakti/contracts';
import { checkZipArchive } from '@shakti/domain';

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The part that makes each Office type what it says it is. */
const MAIN_PART: Readonly<Record<string, string>> = {
  [WORD]: 'word/document.xml',
  [WORKBOOK]: 'xl/workbook.xml',
};

/** Whether the type is a Word document or an Excel workbook, which `checkOfficeFile` checks. */
export function isOfficeType(contentType: string): boolean {
  return Object.hasOwn(MAIN_PART, contentType);
}

/**
 * A Knowledge Vault Word document or workbook before it is `ready` (docs/design/phase1.md §8.4):
 * a ZIP archive whose structure and unpacked size pass the same guard as an import workbook
 * (`checkZipArchive`, held to the import's limits, so a small file that unpacks into gigabytes is
 * refused) and that holds the main part of the type it declares. A file with macros cannot be
 * either type, whose names exclude them.
 */
export function checkOfficeFile(
  bytes: Uint8Array,
  contentType: string,
):
  | { ok: true; sanitising: 'document_checked' | 'sheet_checked' }
  | { ok: false; reason: FileRejectReason } {
  const main = Object.hasOwn(MAIN_PART, contentType) ? MAIN_PART[contentType] : undefined;
  if (main === undefined || bytes.length === 0) return { ok: false, reason: 'file_unreadable' };
  const verdict = checkZipArchive(bytes, IMPORT_LIMITS);
  if (!verdict.ok || !verdict.records.some((record) => record.name === main)) {
    return { ok: false, reason: 'file_unreadable' };
  }
  return { ok: true, sanitising: contentType === WORD ? 'document_checked' : 'sheet_checked' };
}
