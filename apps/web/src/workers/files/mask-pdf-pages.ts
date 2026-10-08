import { KNOWLEDGE_PDF_MAX_PAGES, type FileRejectReason } from '@shakti/contracts';
import type { FileStore } from '@shakti/domain';
import type { DocumentMasker } from '../ocr/mask-document';
import { maskInTime } from './timed-mask';
import { countPdfPages, jpegsToPdf, renderPdfPages } from './pdf-pages';

// A vault PDF is masked one page per delivery (docs/03-roadmap-appendix/phase1.md §8.4,
// docs/07-security.md §5). Reading a dense page four ways takes about half a minute and a delivery
// may run for a minute, so a PDF of several pages can never finish in one. Each delivery draws and
// masks the next page only and keeps it; the delivery for the page after it is sent on by the
// caller. What is kept between deliveries lives in the file store beside the upload, under the
// prefix `<upload>-checked/`: for each page `p0001.jpg` (the masked picture) and then
// `p0001.json` (its size and the regions covered), which is what makes the page count as done.
// The store keeps the first bytes written under a key, so two deliveries that race on one page
// cannot both write it. The upload itself is deleted by the caller once the masked PDF is kept.

/** After this long into a delivery a page that has not even been drawn is given up on. */
export const PAGE_START_LIMIT_MS = 15_000;
/** A page whose masking is still running this long after its turn began is given up on. */
export const PAGE_MASK_LIMIT_MS = 45_000;
/**
 * By this long into the delivery a page's turn in the masking queue must have begun, or the page
 * waits for a later delivery (a page that begins any later cannot finish before the route ends).
 */
export const PAGE_TURN_LIMIT_MS = 25_000;

export interface PageLimits {
  startMs: number;
  maskMs: number;
  turnMs?: number | undefined;
}

/** The folder, in the store, where the masked pages of one upload wait. */
export function partsPrefix(uploadKey: string): string {
  return `${uploadKey.replace(/\.[A-Za-z0-9]+$/, '')}-checked`;
}

const pictureKey = (prefix: string, page: number) =>
  `${prefix}/p${String(page + 1).padStart(4, '0')}.jpg`;
const recordKey = (prefix: string, page: number) =>
  `${prefix}/p${String(page + 1).padStart(4, '0')}.json`;

/** Deletes every masked page kept for an upload (the whole of them, or what a refusal left). */
export async function deleteMaskedPages(store: FileStore, uploadKey: string): Promise<void> {
  const prefix = partsPrefix(uploadKey);
  for (let page = 0; page < KNOWLEDGE_PDF_MAX_PAGES; page += 1) {
    await store.delete(recordKey(prefix, page));
    await store.delete(pictureKey(prefix, page));
  }
}

interface PageRecord {
  widthPt: number;
  heightPt: number;
  regions: number;
}

function parseRecord(bytes: Uint8Array): PageRecord | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (typeof value !== 'object' || value === null) return undefined;
    const { widthPt, heightPt, regions } = value as Record<string, unknown>;
    return typeof widthPt === 'number' &&
      typeof heightPt === 'number' &&
      typeof regions === 'number'
      ? { widthPt, heightPt, regions }
      : undefined;
  } catch {
    return undefined;
  }
}

export type MaskStep =
  | { kind: 'refused'; reason: FileRejectReason }
  /** One page was kept and more remain; `undo` takes that page back if the next could not be sent. */
  | { kind: 'more'; done: number; pages: number; undo: () => Promise<void> }
  /** The delivery is for a page already kept; nothing was done. */
  | { kind: 'stale'; done: number; pages: number }
  | { kind: 'complete'; bytes: Uint8Array; pages: number; regionsMasked: number };

export interface MaskStepInput {
  /** The upload's PDF, as it was uploaded. */
  bytes: Uint8Array;
  uploadKey: string;
  /** The pages kept when the event that started this delivery was sent; absent for the first. */
  maskedPages?: number | undefined;
  /** The pages the file records as sent on (`files.file.continue_check`); 0 or absent before the first. */
  maskedPagesSent?: number | undefined;
}

export interface MaskStepDeps {
  store: FileStore;
  masker: () => Promise<DocumentMasker>;
  /** Closes the masking step a page that ran out of time left busy, so the next one opens afresh. */
  discardMasker?: ((used: DocumentMasker) => Promise<void>) | undefined;
  limits?: PageLimits | undefined;
  /** Milliseconds since the delivery began. */
  elapsed: () => number;
}

/**
 * Masks the next page of a vault PDF and keeps it, or, when that was the last page, answers the
 * masked PDF of them all. A PDF of more than `KNOWLEDGE_PDF_MAX_PAGES` pages, or one that will not
 * open, is refused at once; a page whose numbers cannot be found refuses the file
 * (`file_mask_failed`); a page that is not drawn within `startMs` of the delivery's start, or whose
 * masking runs past `maskMs` once its turn has begun, refuses it (`file_pdf_page_too_dense`). A page
 * that cannot get its turn in the masking queue by `turnMs` is not refused: the delivery throws
 * `integration_unavailable` and is delivered again. A masking step that itself fails is thrown, not
 * blamed on the file.
 *
 * A delivery that finds more pages kept than the file records as sent on (the delivery that kept
 * the page died before it sent the next) sends the chain on itself, `more` without masking; one for
 * a page below the recorded count is stale.
 */
export async function maskNextPdfPage(input: MaskStepInput, deps: MaskStepDeps): Promise<MaskStep> {
  const limits = deps.limits ?? { startMs: PAGE_START_LIMIT_MS, maskMs: PAGE_MASK_LIMIT_MS };
  const prefix = partsPrefix(input.uploadKey);
  let pages: number;
  try {
    pages = await countPdfPages(input.bytes);
  } catch {
    return { kind: 'refused', reason: 'file_unreadable' };
  }
  if (pages === 0) return { kind: 'refused', reason: 'file_unreadable' };
  if (pages > KNOWLEDGE_PDF_MAX_PAGES)
    return { kind: 'refused', reason: 'file_pdf_too_many_pages' };

  // The pages kept so far: those whose record exists, in order.
  let done = 0;
  while (done < pages && (await deps.store.get(recordKey(prefix, done))) !== undefined) done += 1;
  const sent = input.maskedPagesSent ?? 0;
  // The chain has moved past this delivery's event.
  if (done < pages && input.maskedPages !== undefined && input.maskedPages < sent) {
    return { kind: 'stale', done, pages };
  }
  // A page was kept but the delivery that kept it died before sending on: send on from here. The
  // kept page stays, so there is nothing to undo.
  if (done < pages && done > sent) {
    return { kind: 'more', done, pages, undo: () => Promise.resolve() };
  }
  // Every page kept means the last delivery died before the masked PDF was kept: carry on from there.
  if (done < pages) {
    const step = await maskPage(input.bytes, done, prefix, deps, limits);
    if (step !== undefined) return step;
    done += 1;
    if (done < pages) {
      return {
        kind: 'more',
        done,
        pages,
        undo: () => deps.store.delete(recordKey(prefix, done - 1)),
      };
    }
  }
  return assemble(deps.store, prefix, pages);
}

/** Masks and keeps the page at `index`; answers a refusal, or undefined once the page is kept. */
async function maskPage(
  bytes: Uint8Array,
  index: number,
  prefix: string,
  deps: MaskStepDeps,
  limits: PageLimits,
): Promise<MaskStep | undefined> {
  const tooDense: MaskStep = { kind: 'refused', reason: 'file_pdf_page_too_dense' };
  const drawn = renderPdfPages(bytes, 'png', index);
  let page: Awaited<ReturnType<typeof drawn.next>>;
  try {
    page = await drawn.next();
  } catch {
    // A PDF that will not draw is the file's fault; the masking step failing below is not.
    return { kind: 'refused', reason: 'file_unreadable' };
  } finally {
    await drawn.return(undefined);
  }
  if (page.done === true) return { kind: 'refused', reason: 'file_unreadable' };
  const { image, widthPt, heightPt } = page.value;
  if (deps.elapsed() > limits.startMs) {
    image.fill(0);
    return tooDense;
  }

  let timed;
  try {
    timed = await maskInTime(Buffer.from(image), {
      masker: deps.masker,
      discardMasker: deps.discardMasker,
      maskMs: limits.maskMs,
      turnMs: limits.turnMs ?? PAGE_TURN_LIMIT_MS,
      elapsed: deps.elapsed,
    });
  } finally {
    image.fill(0);
  }
  if (timed.kind === 'too_slow') return tooDense;
  const { outcome } = timed;
  if (outcome.status === 'needs_review') return { kind: 'refused', reason: 'file_mask_failed' };

  const picture = new Uint8Array(outcome.image);
  const record: PageRecord = { widthPt, heightPt, regions: outcome.rects };
  // The picture first, the record second: a page counts as kept only once its record is there. A
  // picture left by a delivery that died before the record is replaced rather than trusted.
  await deps.store.delete(pictureKey(prefix, index));
  await deps.store.put(pictureKey(prefix, index), picture, 'image/jpeg');
  await deps.store.put(
    recordKey(prefix, index),
    new TextEncoder().encode(JSON.stringify(record)),
    'application/json',
  );
  return undefined;
}

async function assemble(store: FileStore, prefix: string, pages: number): Promise<MaskStep> {
  const kept: { jpeg: Uint8Array; widthPt: number; heightPt: number }[] = [];
  let regionsMasked = 0;
  for (let index = 0; index < pages; index += 1) {
    const [jpeg, recordBytes] = await Promise.all([
      store.get(pictureKey(prefix, index)),
      store.get(recordKey(prefix, index)),
    ]);
    const record = recordBytes === undefined ? undefined : parseRecord(recordBytes);
    if (jpeg === undefined || record === undefined) {
      // Pages kept earlier have gone missing; the file cannot be read as masked.
      return { kind: 'refused', reason: 'file_unreadable' };
    }
    kept.push({ jpeg, widthPt: record.widthPt, heightPt: record.heightPt });
    regionsMasked += record.regions;
  }
  return { kind: 'complete', bytes: await jpegsToPdf(kept), pages, regionsMasked };
}
