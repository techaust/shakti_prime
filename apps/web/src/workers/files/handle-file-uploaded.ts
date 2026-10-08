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
  continueFileCheck,
  importFileReadable,
  markFileReady,
  markFileScanned,
  rejectFile,
  sha256Hex,
  type AnyCommand,
  type FileStore,
  type KeyValue,
  type Logger,
  type StoredFile,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import type { DocumentMasker } from '../ocr/mask-document';
import { checkOfficeFile, isOfficeType } from './office-check';
import { checkPdf } from './pdf-check';
import { deleteMaskedPages, maskNextPdfPage, type PageLimits } from './mask-pdf-pages';
import { isImageType, reencodeImage } from './reencode-image';

/** The tag GuardDuty Malware Protection for S3 writes on each object it scans. */
export const SCAN_TAG = 'GuardDutyMalwareScanStatus';

/** The purposes whose photos and PDF pages may reach a model, so they are masked before they are kept. */
/** Longer than a delivery may run (the route stops at 60 seconds), so a live claim is never taken over. */
const CLAIM_SECONDS = 90;

const MASKED_PURPOSES: ReadonlySet<string> = new Set(['knowledge']);

export interface FileCheckDeps {
  store: FileStore;
  /** The worker principal (`system:workers`, holding `files.process`), never a person. */
  principal: Principal;
  /** A hosted runtime refuses a file no scanner looked at. */
  hosted: boolean;
  /** The OCR masking of the Phase 0 spike, for vault photos; opened on first use. */
  masker?: () => Promise<DocumentMasker>;
  /** Closes a masking step a page ran out of time on, so the next one opens afresh. */
  discardMasker?: () => Promise<void>;
  /** Claims a vault PDF while a page of it is masked, so two deliveries never mask it at once. */
  keyValue?: KeyValue;
  /** How long a page may take; the defaults of `mask-pdf-pages.ts` unless a test sets them. */
  pageLimits?: PageLimits;
  requestId?: string;
  logger?: Logger;
}

export type FileCheckOutcome =
  | { status: 'ready' | 'rejected' }
  /** A vault PDF with pages still to mask: one page was kept and the next delivery was sent. */
  | { status: 'masking'; maskedPages: number; pages: number }
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
  | { ok: false; reason: FileRejectReason }
  | { ok: 'more'; maskedPages: number; pages: number };

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
 *    kept as a PDF of the masked pictures; a delivery masks one page and sends the next, since a
 *    page takes about half a minute and a delivery lives for a minute), a vault Word document or workbook checked as the ZIP
 *    archive of its type. A changed copy is stored under its own key and the
 *    upload's bytes are deleted, every version of them.
 * 3. `ready` with the checked copy's key, type, size and checksum, or `rejected` with the reason
 *    the uploader is shown; a rejected file's bytes are deleted.
 */
export async function handleFileUploaded(
  event: DeliveredEvent,
  deps: FileCheckDeps,
): Promise<FileCheckOutcome> {
  const begun = performance.now();
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
    if (file.purpose === 'knowledge' && file.contentType === 'application/pdf') {
      await deleteMaskedPages(deps.store, file.key);
    }
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
  const checked = await check(file, bytes, deps, {
    maskedPages: maskedPagesOf(event),
    elapsed: () => performance.now() - begun,
    // The next page's delivery: the same event again, carrying how many pages are kept.
    sendOn: async (kept) => {
      await run(continueFileCheck, { entityId: file.entityId, fileId, maskedPages: kept });
    },
  });
  if (checked.ok === 'more') {
    log.log('info', 'files.check_masking', {
      requestId: deps.requestId,
      fileId,
      maskedPages: checked.maskedPages,
      pages: checked.pages,
    });
    return { status: 'masking', maskedPages: checked.maskedPages, pages: checked.pages };
  }
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
  if (file.purpose === 'knowledge' && file.contentType === 'application/pdf') {
    await deleteMaskedPages(deps.store, file.key);
  }
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
  if (file.purpose === 'knowledge' && file.contentType === 'application/pdf') {
    await deleteMaskedPages(store, original);
  }
}

/** The pages kept so far, when the event is the one a vault PDF's earlier delivery sent on. */
function maskedPagesOf(event: DeliveredEvent): number | undefined {
  const value: unknown = (event.payload as Record<string, unknown>).maskedPages;
  return typeof value === 'number' ? value : undefined;
}

/** What `check` needs of the delivery it runs in. */
interface Delivery {
  maskedPages: number | undefined;
  /** Milliseconds since the delivery began. */
  elapsed: () => number;
  /** Sends the checks on to the next page, once `kept` pages are kept. */
  sendOn: (kept: number) => Promise<void>;
}

/**
 * A vault PDF, one page at a time: the page after the ones kept is masked and kept, then the next
 * delivery is sent; the last page ends in the masked PDF. A claim on the file (when a store for it
 * is given) keeps two deliveries from masking at once; one that finds it taken is delivered again.
 */
async function maskVaultPdf(
  file: StoredFile,
  bytes: Uint8Array,
  deps: FileCheckDeps,
  delivery: Delivery,
  masker: () => Promise<DocumentMasker>,
): Promise<Checked> {
  const claim = `filecheck:${file.id}`;
  if (deps.keyValue !== undefined) {
    const held = await deps.keyValue.setIfAbsent(claim, '1', CLAIM_SECONDS);
    if (!held) {
      throw new DomainError('conflict', `file ${file.id} is being checked`, {
        reason: 'event_in_progress',
      });
    }
  }
  try {
    const step = await maskNextPdfPage(
      { bytes, uploadKey: file.key, maskedPages: delivery.maskedPages },
      {
        store: deps.store,
        masker,
        discardMasker: deps.discardMasker,
        limits: deps.pageLimits,
        elapsed: delivery.elapsed,
      },
    );
    if (step.kind === 'refused') return { ok: false, reason: step.reason };
    if (step.kind === 'stale') return { ok: 'more', maskedPages: step.done, pages: step.pages };
    if (step.kind === 'more') {
      try {
        await delivery.sendOn(step.done);
      } catch (error) {
        // Not sent on: take the page back so this delivery, tried again, does it over.
        await step.undo().catch(() => undefined);
        throw error;
      }
      return { ok: 'more', maskedPages: step.done, pages: step.pages };
    }
    return {
      ok: true,
      sanitising: 'masked',
      bytes: step.bytes,
      contentType: 'application/pdf',
      regionsMasked: step.regionsMasked,
    };
  } finally {
    await deps.keyValue?.del(claim).catch(() => undefined);
  }
}

/** Where a changed copy goes: beside the upload, under a name of its own. */
export function checkedKey(file: Pick<StoredFile, 'key'>, contentType: UploadContentType): string {
  const stem = file.key.replace(/\.[A-Za-z0-9]+$/, '');
  return `${stem}-checked.${EXTENSIONS[contentType]}`;
}

async function check(
  file: StoredFile,
  bytes: Uint8Array,
  deps: FileCheckDeps,
  delivery: Delivery,
): Promise<Checked> {
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
      // never stored past this check nor sent to a model. Where no masking step is set up the
      // file is refused at once, with a reason of its own, rather than delivered again for good.
      if (deps.masker === undefined) return { ok: false, reason: 'file_masking_unavailable' };
      return maskVaultPdf(file, bytes, deps, delivery, deps.masker);
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
    if (deps.masker === undefined) return { ok: false, reason: 'file_masking_unavailable' };
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
