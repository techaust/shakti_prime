// OCR masking of customer document photos (BLUEPRINT §5 and §7.5, 07-security.md §5,
// ARCHITECTURE §9). Reads the photo, finds Aadhaar and bank account numbers, covers the hidden
// digits and every QR code with opaque boxes, and hands back only the masked image, the masked
// text and the last four digits. The caller's buffer is overwritten with zeros once it has been read, and
// nothing here writes to disk or to a log.
import sharp from 'sharp';
import { createWorker, PSM, type Page, type Worker } from 'tesseract.js';
import type { MaskedText } from '@shakti/domain';
import { planMasks, scrubHiddenDigits, type Box, type MaskPlan, type OcrLine } from './plan-masks';
import { scanQrCodes, SMALL_PHOTO_PX } from './qr-cover';
import { reviewCause, type ExpectedNumber, type ReviewCause } from './review';

export interface DocumentMaskerOptions {
  /**
   * Folder holding `eng.traineddata.gz`. Always a local folder: the worker must not fetch the
   * language data from the internet while it handles a customer's document.
   */
  langPath: string;
}

export interface MaskRequest {
  /**
   * The numbers the upload slot says the document carries: the Aadhaar slot of a subsidy
   * file expects `aadhaar`, a passbook or cancelled-cheque slot `bank_account`. When one of
   * them is not found, nothing is kept. Leave empty for a photo of unknown kind (WhatsApp).
   */
  expect?: ExpectedNumber[];
}

export type MaskOutcome =
  | ({
      /** `masked`: at least one number was covered. `clean`: nothing to cover was found. */
      status: 'masked' | 'clean';
      /** JPEG, metadata removed, the same size and orientation as the upright photo. */
      image: Buffer;
      /** Rectangles drawn: hidden digits and QR codes. */
      rects: number;
      /** QR codes covered, and where (positions only; what a code held is never kept). */
      qr: { covered: number; decoded: number; estimated: number; boxes: Box[] };
      timings: MaskTimings;
    } & MaskedText)
  | {
      /**
       * The photo is, or looks like, an Aadhaar card (or the slot expects a bank account) but
       * the number could not be located, so there is nothing safe to keep: no image and no
       * text are returned and the upload goes back to a person to retake or mask by hand.
       */
      status: 'needs_review';
      cause: ReviewCause;
      timings: MaskTimings;
    };

export interface MaskTimings {
  prepareMs: number;
  /** Finding the QR codes. */
  qrMs: number;
  ocrMs: number;
  maskMs: number;
  totalMs: number;
  passes: number;
}

export interface DocumentMasker {
  /** Takes ownership of `photo`: its bytes are zeroed before this returns. */
  mask(photo: Buffer, request?: MaskRequest): Promise<MaskOutcome>;
  close(): Promise<void>;
}

// Upscale small photos so digits reach the height the OCR engine reads best.
const MIN_WIDTH = 1600;
const MAX_SCALE = 3;
// How much a small photo is enlarged for the second look for QR codes.
const ENHANCE_SCALE = 2;

interface Pass {
  image: 'upscaled' | 'native';
  psm: PSM;
}

// Each pass reads the photo a different way; a number any pass finds is covered. Reading
// every photo four ways costs time but a number missed by one reading is often found by the
// next, and a missed number is a leak.
const PASSES: Pass[] = [
  { image: 'upscaled', psm: PSM.AUTO },
  { image: 'upscaled', psm: PSM.SPARSE_TEXT },
  { image: 'upscaled', psm: PSM.SINGLE_BLOCK },
  { image: 'native', psm: PSM.SINGLE_BLOCK },
];

function toLines(page: Page): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        lines.push({
          words: line.words.map((w) => ({
            text: w.text,
            bbox: w.bbox,
            symbols: w.symbols.map((s) => ({ text: s.text, bbox: s.bbox })),
          })),
        });
      }
    }
  }
  return lines;
}

function textOf(lines: OcrLine[]): string {
  return lines.map((l) => l.words.map((w) => w.text).join(' ')).join('\n');
}

function scaleBox(box: Box, scale: number): Box {
  return { x0: box.x0 / scale, y0: box.y0 / scale, x1: box.x1 / scale, y1: box.y1 / scale };
}

function coverSvg(width: number, height: number, rects: Box[]): Buffer {
  const shapes = rects
    .map((r) => {
      const x = Math.max(0, Math.floor(r.x0));
      const y = Math.max(0, Math.floor(r.y0));
      const w = Math.min(width, Math.ceil(r.x1)) - x;
      const h = Math.min(height, Math.ceil(r.y1)) - y;
      return w > 0 && h > 0 ? `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>` : '';
    })
    .join('');
  // Opaque black over the digits: the image is a record, so the cover is not a design colour.
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g fill="#000">${shapes}</g></svg>`,
  );
}

function score(plan: MaskPlan): number {
  const c = plan.masked.counts;
  return c.aadhaar * 2 + c.aadhaar_unverified + c.bank_account;
}

export async function createDocumentMasker(
  options: DocumentMaskerOptions,
): Promise<DocumentMasker> {
  const worker: Worker = await createWorker('eng', 1, {
    langPath: options.langPath,
    cacheMethod: 'none',
    gzip: true,
  });
  await worker.setParameters({ user_defined_dpi: '300' });

  async function read(image: Buffer, psm: PSM): Promise<OcrLine[]> {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
    return toLines(data);
  }

  // The one OCR worker keeps a page mode between `setParameters` and `recognize`, so two masks in
  // one process (several file checks share an instance) wait their turn rather than interleave.
  let turn: Promise<unknown> = Promise.resolve();
  function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
    const result = turn.then(work, work);
    turn = result.catch(() => undefined);
    return result;
  }

  async function maskNow(photo: Buffer, request: MaskRequest): Promise<MaskOutcome> {
    const started = performance.now();
    // Upright copy (camera orientation applied) in memory; the caller's bytes are then wiped.
    const upright = await sharp(photo).rotate().toBuffer({ resolveWithObject: true });
    photo.fill(0);
    const { width, height } = upright.info;
    const scale = Math.min(MAX_SCALE, Math.max(1, MIN_WIDTH / width));
    const images: Record<Pass['image'], { data: Buffer; scale: number }> = {
      upscaled: {
        data: await (
          scale > 1
            ? sharp(upright.data)
                .resize(Math.round(width * scale), Math.round(height * scale), {
                  kernel: 'lanczos3',
                })
                .grayscale()
                .sharpen({ sigma: 1 })
            : sharp(upright.data).grayscale()
        )
          .png()
          .toBuffer(),
        scale,
      },
      native: { data: await sharp(upright.data).grayscale().png().toBuffer(), scale: 1 },
    };
    const prepareMs = performance.now() - started;

    // Every QR code on the photo is located and covered, whatever it holds: an Aadhaar QR
    // code can carry the full number. The decoded pixels are wiped once scanned.
    const qrStarted = performance.now();
    const pixels = await sharp(upright.data).ensureAlpha().raw().toBuffer();
    // A small photo is often a forwarded, blurred one: its code is looked for on an enlarged,
    // contrast-stretched and sharpened copy as well, where a blurred code can be read.
    const enhanced =
      Math.max(width, height) <= SMALL_PHOTO_PX
        ? await sharp(upright.data)
            .resize(width * ENHANCE_SCALE, height * ENHANCE_SCALE, { kernel: 'lanczos3' })
            .grayscale()
            .normalise()
            .sharpen({ sigma: 3, m1: 2, m2: 4 })
            .extractChannel(0)
            .raw()
            .toBuffer({ resolveWithObject: true })
        : undefined;
    const qr = scanQrCodes(
      {
        data: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length),
        width,
        height,
      },
      enhanced
        ? {
            gray: {
              data: new Uint8ClampedArray(
                enhanced.data.buffer,
                enhanced.data.byteOffset,
                enhanced.data.length,
              ),
              width: enhanced.info.width,
              height: enhanced.info.height,
            },
            scale: enhanced.info.width / width,
          }
        : undefined,
    );
    pixels.fill(0);
    enhanced?.data.fill(0);
    const qrMs = performance.now() - qrStarted;

    const ocrStarted = performance.now();
    const plans: MaskPlan[] = [];
    const rects: Box[] = [];
    let readText = '';
    let passes = 0;
    for (const pass of PASSES) {
      if (pass.image === 'native' && scale === 1) continue;
      const source = images[pass.image];
      const lines = await read(source.data, pass.psm);
      passes += 1;
      const plan = planMasks(lines);
      plans.push(plan);
      rects.push(...plan.rects.map((r) => scaleBox(r, source.scale)));
      readText += `${textOf(lines)}\n`;
    }
    images.upscaled.data.fill(0);
    images.native.data.fill(0);
    const ocrMs = performance.now() - ocrStarted;

    const maskStarted = performance.now();
    const cause = reviewCause({
      expect: request.expect ?? [],
      readText,
      aadhaarFound: plans.some(
        (p) => p.masked.counts.aadhaar + p.masked.counts.aadhaar_unverified > 0,
      ),
      bankFound: plans.some((p) => p.masked.counts.bank_account > 0),
      qrUncovered: qr.uncovered,
    });
    if (cause) {
      upright.data.fill(0);
      const maskMs = performance.now() - maskStarted;
      return {
        status: 'needs_review',
        cause,
        timings: { prepareMs, qrMs, ocrMs, maskMs, totalMs: performance.now() - started, passes },
      };
    }
    rects.push(...qr.boxes);

    // The text and the last four digits come from the reading that found the most; digits
    // another reading found to be hidden are scrubbed from it as well.
    const best = plans.reduce((a, b) => (score(b) > score(a) ? b : a));
    const text = scrubHiddenDigits(
      best.masked.text,
      plans.flatMap((p) => p.hiddenDigits),
    );
    const image = await sharp(upright.data)
      .composite([{ input: coverSvg(width, height, rects), top: 0, left: 0 }])
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    upright.data.fill(0);
    const maskMs = performance.now() - maskStarted;
    return {
      status: rects.length > 0 ? 'masked' : 'clean',
      image,
      rects: rects.length,
      qr: {
        covered: qr.boxes.length,
        decoded: qr.decoded,
        estimated: qr.estimated,
        boxes: qr.boxes,
      },
      ...best.masked,
      text,
      timings: { prepareMs, qrMs, ocrMs, maskMs, totalMs: performance.now() - started, passes },
    };
  }

  return {
    mask(photo, request = {}) {
      return oneAtATime(() => maskNow(photo, request));
    },
    async close() {
      await worker.terminate();
    },
  };
}
