import { KNOWLEDGE_PDF_MAX_PAGES, type FileRejectReason } from '@shakti/contracts';
import type { DocumentMasker } from '../ocr/mask-document';

// A vault PDF is read as pictures, never as a PDF (docs/design/phase1.md §8.4, docs/SECURITY.md
// §5): each page is drawn to an image, the image goes through the same masking step as a vault
// photo, and only the masked pages are kept (assembled into a PDF of pictures) and sent to a
// model. MuPDF (WebAssembly) draws the pages; it is loaded on first use, never at import, so the
// build and every other worker start without it.

/** Pixels per inch a page is drawn at: enough for the OCR step to read body text. */
export const PDF_RENDER_DPI = 150;
/** A page larger than this many pixels is drawn smaller (a poster-sized page must not fill memory). */
const MAX_PAGE_PIXELS = 16_000_000;
const JPEG_QUALITY = 85;
const POINTS_PER_INCH = 72;

type Mupdf = typeof import('mupdf');

async function loadMupdf(): Promise<Mupdf> {
  return import('mupdf');
}

/** One page drawn as an image, with its size in PDF points. */
export interface RenderedPage {
  image: Uint8Array;
  widthPt: number;
  heightPt: number;
}

function openPdf(mupdf: Mupdf, bytes: Uint8Array) {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  if (doc.needsPassword()) {
    doc.destroy();
    throw new Error('the PDF needs a password');
  }
  return doc;
}

/** How many pages the PDF has; throws when it cannot be opened. */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const mupdf = await loadMupdf();
  const doc = openPdf(mupdf, bytes);
  try {
    return doc.countPages();
  } finally {
    doc.destroy();
  }
}

/**
 * Draws the pages one at a time (only one page's pixels are in memory at once) as PNG, or as
 * JPEG when asked, in reading order.
 */
export async function* renderPdfPages(
  bytes: Uint8Array,
  format: 'png' | 'jpeg',
): AsyncGenerator<RenderedPage> {
  const mupdf = await loadMupdf();
  const doc = openPdf(mupdf, bytes);
  try {
    const count = doc.countPages();
    for (let i = 0; i < count; i += 1) {
      const page = doc.loadPage(i);
      try {
        const [x0, y0, x1, y1] = page.getBounds();
        const widthPt = x1 - x0;
        const heightPt = y1 - y0;
        const wanted = PDF_RENDER_DPI / POINTS_PER_INCH;
        const limit = Math.sqrt(MAX_PAGE_PIXELS / Math.max(1, widthPt * heightPt));
        const scale = Math.min(wanted, limit);
        const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB);
        try {
          yield {
            image: format === 'png' ? pixmap.asPNG() : pixmap.asJPEG(JPEG_QUALITY),
            widthPt,
            heightPt,
          };
        } finally {
          pixmap.destroy();
        }
      } finally {
        page.destroy();
      }
    }
  } finally {
    doc.destroy();
  }
}

/** The pages of a PDF that holds only pictures (a masked PDF), each as a JPEG, in order. */
export async function renderMaskedPages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const pages: Uint8Array[] = [];
  for await (const page of renderPdfPages(bytes, 'jpeg')) pages.push(page.image);
  return pages;
}

/** A PDF of one picture per page, each page the size of the page it came from. */
async function assemblePdf(
  pages: readonly { jpeg: Uint8Array; widthPt: number; heightPt: number }[],
): Promise<Uint8Array> {
  const mupdf = await loadMupdf();
  const doc = new mupdf.PDFDocument();
  try {
    pages.forEach((page, i) => {
      const image = doc.addImage(new mupdf.Image(page.jpeg));
      const { widthPt: w, heightPt: h } = page;
      const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Page Do Q`;
      const added = doc.addPage([0, 0, w, h], 0, { XObject: { Page: image } }, content);
      doc.insertPage(i, added);
    });
    return doc.saveToBuffer('compress').asUint8Array().slice();
  } finally {
    doc.destroy();
  }
}

export type MaskedPdf =
  | { ok: true; bytes: Uint8Array; pages: number; regionsMasked: number }
  | { ok: false; reason: FileRejectReason };

/**
 * A vault PDF with every page masked: more than `KNOWLEDGE_PDF_MAX_PAGES` pages is refused
 * (`file_pdf_too_many_pages`), a PDF MuPDF cannot open `file_unreadable`, and a page whose
 * numbers the masking step cannot find `file_mask_failed`, so nothing is kept. Pages are drawn
 * and masked one at a time; the result is a PDF of pictures only, with no text layer, no
 * annotation and nothing of the original file in it.
 */
export async function maskPdf(bytes: Uint8Array, masker: DocumentMasker): Promise<MaskedPdf> {
  let count: number;
  try {
    count = await countPdfPages(bytes);
  } catch {
    return { ok: false, reason: 'file_unreadable' };
  }
  if (count === 0) return { ok: false, reason: 'file_unreadable' };
  if (count > KNOWLEDGE_PDF_MAX_PAGES) return { ok: false, reason: 'file_pdf_too_many_pages' };
  const masked: { jpeg: Uint8Array; widthPt: number; heightPt: number }[] = [];
  let regionsMasked = 0;
  const pages = renderPdfPages(bytes, 'png');
  try {
    for (;;) {
      let next: IteratorResult<RenderedPage>;
      try {
        next = await pages.next();
      } catch {
        // A PDF that will not draw is the file's fault; the masking step failing below is not.
        return { ok: false, reason: 'file_unreadable' };
      }
      if (next.done === true) break;
      const page = next.value;
      // The masker wipes the buffer it is given and answers a JPEG without metadata.
      const outcome = await masker.mask(Buffer.from(page.image), { expect: [] });
      page.image.fill(0);
      if (outcome.status === 'needs_review') return { ok: false, reason: 'file_mask_failed' };
      regionsMasked += outcome.rects;
      masked.push({
        jpeg: new Uint8Array(outcome.image),
        widthPt: page.widthPt,
        heightPt: page.heightPt,
      });
    }
  } finally {
    await pages.return(undefined);
  }
  return {
    ok: true,
    bytes: await assemblePdf(masked),
    pages: masked.length,
    regionsMasked,
  };
}
