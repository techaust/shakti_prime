import {
  DomainError,
  type DeliveredEvent,
  type FileRejectReason,
  type FileSanitising,
  type Principal,
  type UploadContentType,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  EXTENSIONS,
  getStoredFile,
  importFileReadable,
  markFileReady,
  markFileScanned,
  rejectFile,
  sha256Hex,
  type AnyCommand,
  type FileStore,
  type Logger,
  type StoredFile,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import type { DocumentMasker } from '../ocr/mask-document';
import { checkOfficeFile, isOfficeType } from './office-check';
import { checkPdf } from './pdf-check';
import { maskPdf } from './pdf-pages';
import { isImageType, reencodeImage } from './reencode-image';

/** The tag GuardDuty Malware Protection for S3 writes on each object it scans. */
export const SCAN_TAG = 'GuardDutyMalwareScanStatus';

/** The purposes whose photos and PDF pages may reach a model, so they are masked before they are kept. */
const MASKED_PURPOSES: ReadonlySet<string> = new Set(['knowledge']);

export interface FileCheckDeps {
  store: FileStore;
  /** The worker principal (`system:workers`, holding `files.process`), never a person. */
  principal: Principal;
  /** A hosted runtime refuses a file no scanner looked at. */
  hosted: boolean;
  /** The OCR masking of the Phase 0 spike, for vault photos; opened on first use. */
  masker?: () => Promise<DocumentMasker>;
  requestId?: string;
  logger?: Logger;
}

export type FileCheckOutcome =
  | { status: 'ready' | 'rejected' }
  /** The event names a file the worker cannot see, or one outside the checks (a WhatsApp file). */
  | { status: 'skipped' };

type Checked =
  | {
      ok: true;
      sanitising: FileSanitising;
      bytes: Uint8Array;
      contentType: UploadContentType;
      regionsMasked: number;
    }
  | { ok: false; reason: FileRejectReason };

/**
 * `files.file.uploaded` (docs/04-architecture.md §9): the checks an upload passes before anyone can
 * use it, run as the worker principal. Safe to deliver more than once: each step starts from the
 * file's recorded status, so a repeat carries on where the last delivery stopped, and a file
 * already `ready` or `rejected` is left alone.
 *
 * 1. The malware scan: GuardDuty's tag on the object. `NO_THREATS_FOUND` passes; no tag yet
 *    throws `integration_unavailable`, so the queue delivers again later; a threat, or a scan that
 *    could not run, rejects the file. Where no scanner exists the file is `not_scanned`, which only
 *    an environment that is not hosted accepts.
 * 2. The bytes: an image is re-encoded, a PDF checked, a vault photo masked, an import file read
 *    as the CSV or workbook it says it is (a vault PDF is drawn page by page, each page masked, and
 *    kept as a PDF of the masked pictures), a vault Word document or workbook checked as the ZIP
 *    archive of its type. A changed copy is stored under its own key and the
 *    upload's bytes are deleted, every version of them.
 * 3. `ready` with the checked copy's key, type, size and checksum, or `rejected` with the reason
 *    the uploader is shown; a rejected file's bytes are deleted.
 */
export async function handleFileUploaded(
  event: DeliveredEvent,
  deps: FileCheckDeps,
): Promise<FileCheckOutcome> {
  const log = deps.logger ?? appLogger;
  const scope = {
    entityIds: [event.entityId],
    ...(deps.requestId === undefined ? {} : { requestId: deps.requestId }),
  };
  const fileId = event.aggregateId;
  const read = () =>
    executeQuery(deps.principal, scope, (ctx) => getStoredFile(ctx, fileId), {
      name: 'files.check.read',
    });
  const run = (command: AnyCommand, input: unknown) =>
    executeCommand(deps.principal, scope, command, input, { hosted: deps.hosted });

  const reject = async (file: StoredFile, reason: FileRejectReason, scanStatus?: string) => {
    // The refusal records the key first, so a deletion that fails is tried on the next delivery.
    await run(rejectFile, {
      entityId: file.entityId,
      fileId: file.id,
      reason,
      ...(scanStatus === undefined ? {} : { scanStatus }),
    });
    await deps.store.delete(file.key);
    log.log('info', 'files.check_rejected', { requestId: deps.requestId, fileId, reason });
    return { status: 'rejected' as const };
  };

  let file = await read();
  if (file?.entityId !== event.entityId) {
    log.log('warn', 'files.check_missing', { requestId: deps.requestId, fileId });
    return { status: 'skipped' };
  }
  if (file.status === 'ready' || file.status === 'rejected') {
    await deleteOriginal(file, deps.store);
    return { status: file.status };
  }

  if (file.status === 'scanning') {
    if (deps.store.scanned) {
      const verdict = (await deps.store.tags(file.key))[SCAN_TAG];
      if (verdict === undefined) {
        throw new DomainError('integration_unavailable', `file ${fileId} is not scanned yet`);
      }
      if (verdict === 'THREATS_FOUND') return reject(file, 'file_infected', verdict);
      if (verdict !== 'NO_THREATS_FOUND') {
        // UNSUPPORTED, ACCESS_DENIED or FAILED: nothing vouches for the bytes.
        return reject(file, 'file_scan_failed', verdict.replace(/[^A-Z_]/g, '').slice(0, 40));
      }
      await run(markFileScanned, {
        entityId: file.entityId,
        fileId,
        verdict: 'no_threats_found',
      });
    } else {
      if (deps.hosted) return reject(file, 'file_not_scanned');
      await run(markFileScanned, { entityId: file.entityId, fileId, verdict: 'not_scanned' });
    }
    file = await read();
    if (file === undefined) return { status: 'skipped' };
  }
  if (file.status !== 'scanned' && file.status !== 'not_scanned') return { status: 'skipped' };

  const bytes = await deps.store.get(file.key);
  if (bytes === undefined || sha256Hex(bytes) !== file.sha256) {
    return reject(file, 'file_unreadable');
  }
  const checked = await check(file, bytes, deps);
  if (!checked.ok) return reject(file, checked.reason);

  const sha256 = sha256Hex(checked.bytes);
  const replaced = sha256 !== file.sha256 || checked.contentType !== file.contentType;
  const key = replaced ? checkedKey(file, checked.contentType) : file.key;
  if (replaced) await deps.store.put(key, checked.bytes, checked.contentType);
  await run(markFileReady, {
    entityId: file.entityId,
    fileId,
    sanitising: checked.sanitising,
    stored: { key, contentType: checked.contentType, size: checked.bytes.length, sha256 },
    regionsMasked: checked.regionsMasked,
  });
  if (replaced) await deps.store.delete(file.key);
  log.log('info', 'files.check_ready', {
    requestId: deps.requestId,
    fileId,
    sanitising: checked.sanitising,
  });
  return { status: 'ready' };
}

/**
 * The upload's own bytes, which a refusal or a checked copy leaves behind: deleted with every
 * version on each delivery of a file that is done, so none survives a deletion that failed once.
 */
async function deleteOriginal(file: StoredFile, store: FileStore): Promise<void> {
  const original = file.originalKey;
  if (original === undefined) return;
  if (file.status === 'ready' && original === file.key) return;
  await store.delete(original);
}

/** Where a changed copy goes: beside the upload, under a name of its own. */
export function checkedKey(file: Pick<StoredFile, 'key'>, contentType: UploadContentType): string {
  const stem = file.key.replace(/\.[A-Za-z0-9]+$/, '');
  return `${stem}-checked.${EXTENSIONS[contentType]}`;
}

async function check(file: StoredFile, bytes: Uint8Array, deps: FileCheckDeps): Promise<Checked> {
  if (file.purpose === 'import') {
    // The rows are read and checked when the job starts; here, the file is what it says it is.
    return importFileReadable(bytes, file.contentType)
      ? {
          ok: true,
          sanitising: 'sheet_checked',
          bytes,
          contentType: file.contentType as UploadContentType,
          regionsMasked: 0,
        }
      : { ok: false, reason: 'file_unreadable' };
  }
  if (file.purpose === 'knowledge' && isOfficeType(file.contentType)) {
    // A vault Word document or workbook: its text is read when it is indexed, never here.
    const office = checkOfficeFile(bytes, file.contentType);
    return office.ok
      ? {
          ok: true,
          sanitising: office.sanitising,
          bytes,
          contentType: file.contentType as UploadContentType,
          regionsMasked: 0,
        }
      : office;
  }
  if (file.contentType === 'application/pdf') {
    const pdf = checkPdf(bytes);
    if (pdf.ok && MASKED_PURPOSES.has(file.purpose)) {
      // A vault PDF is masked page by page and only the masked pages are kept: the original is
      // never stored past this check nor sent to a model.
      if (deps.masker === undefined) {
        throw new DomainError('integration_unavailable', 'the masking step is not available here');
      }
      const masked = await maskPdf(bytes, await deps.masker());
      return masked.ok
        ? {
            ok: true,
            sanitising: 'masked',
            bytes: masked.bytes,
            contentType: 'application/pdf',
            regionsMasked: masked.regionsMasked,
          }
        : masked;
    }
    return pdf.ok
      ? {
          ok: true,
          sanitising: 'pdf_checked',
          bytes,
          contentType: 'application/pdf',
          regionsMasked: 0,
        }
      : pdf;
  }
  if (!isImageType(file.contentType)) return { ok: false, reason: 'file_unreadable' };
  if (MASKED_PURPOSES.has(file.purpose)) {
    if (deps.masker === undefined) {
      throw new DomainError('integration_unavailable', 'the masking step is not available here');
    }
    // The masker reads the photo whatever its format, applies its orientation and answers a JPEG
    // with no metadata, so it re-encodes as well; it wipes the buffer it is given.
    const masker = await deps.masker();
    const outcome = await masker.mask(Buffer.from(bytes), { expect: [] });
    if (outcome.status === 'needs_review') return { ok: false, reason: 'file_mask_failed' };
    return {
      ok: true,
      sanitising: 'masked',
      bytes: new Uint8Array(outcome.image),
      contentType: 'image/jpeg',
      regionsMasked: outcome.rects,
    };
  }
  const image = await reencodeImage(bytes, file.contentType);
  return image.ok
    ? {
        ok: true,
        sanitising: 're_encoded',
        bytes: image.bytes,
        contentType: image.contentType,
        regionsMasked: 0,
      }
    : image;
}
