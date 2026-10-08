import { KNOWLEDGE_PDF_MAX_PAGES, type FileRejectReason } from '@shakti/contracts';
import type { PDFiumDocument, PDFiumLibrary } from '@hyzyla/pdfium';
import sharp from 'sharp';
import type { DocumentMasker } from '../ocr/mask-document';

// A vault PDF is read as pictures, never as a PDF (docs/design/phase1.md §8.4, docs/SECURITY.md
// §5): each page is drawn to an image, the image goes through the same masking step as a vault
// photo, and only the masked pages are kept (assembled into a PDF of pictures) and sent to a
// model. PDFium (WebAssembly) draws the pages; it is loaded on first use, never at import, so the
// build and every other worker start without it.

/** Pixels per inch a page is drawn at: enough for the OCR step to read body text. */
export const PDF_RENDER_DPI = 150;
/** A page larger than this many pixels is drawn smaller (a poster-sized page must not fill memory). */
const MAX_PAGE_PIXELS = 16_000_000;
const JPEG_QUALITY = 85;
const POINTS_PER_INCH = 72;

async function openPdf(
  bytes: Uint8Array,
): Promise<{ library: PDFiumLibrary; doc: PDFiumDocument }> {
  const { PDFiumLibrary: Library } = await import('@hyzyla/pdfium');
  const library = await Library.init();
  try {
    // A copy: PDFium takes the bytes into its own memory, and the caller's stay untouched.
    const doc = await library.loadDocument(new Uint8Array(bytes));
    return { library, doc };
  } catch (error) {
    library.destroy();
    throw error;
  }
}

/** One page drawn as an image, with its size in PDF points. */
export interface RenderedPage {
  image: Uint8Array;
  widthPt: number;
  heightPt: number;
}

/** How many pages the PDF has; throws when it cannot be opened (a password counts as that). */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const { library, doc } = await openPdf(bytes);
  try {
    return doc.getPageCount();
  } finally {
    doc.destroy();
    library.destroy();
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
  const { library, doc } = await openPdf(bytes);
  try {
    const count = doc.getPageCount();
    for (let i = 0; i < count; i += 1) {
      const page = doc.getPage(i);
      const { originalWidth: widthPt, originalHeight: heightPt } = page.getOriginalSize();
      const wanted = PDF_RENDER_DPI / POINTS_PER_INCH;
      const limit = Math.sqrt(MAX_PAGE_PIXELS / Math.max(1, widthPt * heightPt));
      const drawn = await page.render({
        scale: Math.min(wanted, limit),
        colorSpace: 'BGRA',
        transparent: false,
        render: 'bitmap',
      });
      // PDFium answers blue, green, red, alpha; the picture library reads red, green, blue.
      const px = drawn.data;
      for (let o = 0; o + 3 < px.length; o += 4) {
        const blue = px[o] ?? 0;
        px[o] = px[o + 2] ?? 0;
        px[o + 2] = blue;
      }
      const raw = sharp(Buffer.from(px.buffer, px.byteOffset, px.byteLength), {
        raw: { width: drawn.width, height: drawn.height, channels: 4 },
      }).removeAlpha();
      const encoded =
        format === 'png'
          ? await raw.png().toBuffer()
          : await raw.jpeg({ quality: JPEG_QUALITY }).toBuffer();
      px.fill(0);
      yield { image: new Uint8Array(encoded), widthPt, heightPt };
    }
  } finally {
    doc.destroy();
    library.destroy();
  }
}

/** The pages of a PDF that holds only pictures (a masked PDF), each as a JPEG, in order. */
export async function renderMaskedPages(bytes: Uint8Array): Promise<Uint8Array[]> {
  const pages: Uint8Array[] = [];
  for await (const page of renderPdfPages(bytes, 'jpeg')) pages.push(page.image);
  return pages;
}

/**
 * A PDF of one picture per page, each page the size of the page it came from. PDFium reads PDFs
 * but writes none from pictures, so the file is written directly: a catalogue, a page list and,
 * per page, the JPEG as an image object plus one drawing instruction. Nothing else goes in it.
 */
export async function jpegsToPdf(
  pages: readonly { jpeg: Uint8Array; widthPt: number; heightPt: number }[],
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let length = 0;
  const offsets: number[] = [];
  const write = (...parts: (string | Uint8Array)[]) => {
    for (const part of parts) {
      const chunk = typeof part === 'string' ? Buffer.from(part, 'latin1') : Buffer.from(part);
      chunks.push(chunk);
      length += chunk.length;
    }
  };
  const begin = (id: number) => {
    offsets[id] = length;
    write(`${String(id)} 0 obj\n`);
  };
  write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  begin(1);
  write('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  const kids = pages.map((_, i) => `${String(3 + i * 3)} 0 R`).join(' ');
  write(`<< /Type /Pages /Count ${String(pages.length)} /Kids [${kids}] >>\nendobj\n`);
  for (const [i, page] of pages.entries()) {
    let jpeg = Buffer.from(page.jpeg);
    let meta = await sharp(jpeg).metadata();
    if (meta.channels !== 1 && meta.channels !== 3) {
      jpeg = await sharp(jpeg)
        .toColourspace('srgb')
        .removeAlpha()
        .jpeg({ quality: JPEG_QUALITY })
        .toBuffer();
      meta = await sharp(jpeg).metadata();
    }
    const space = meta.channels === 1 ? '/DeviceGray' : '/DeviceRGB';
    const w = page.widthPt.toFixed(2);
    const h = page.heightPt.toFixed(2);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Page Do Q`;
    const id = 3 + i * 3;
    begin(id);
    write(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Page ${String(id + 1)} 0 R >> >> /Contents ${String(id + 2)} 0 R >>\nendobj\n`,
    );
    begin(id + 1);
    write(
      `<< /Type /XObject /Subtype /Image /Width ${String(meta.width)} /Height ${String(meta.height)} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${String(jpeg.length)} >>\nstream\n`,
      jpeg,
      '\nendstream\nendobj\n',
    );
    begin(id + 2);
    write(`<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream\nendobj\n`);
  }
  const size = 3 + pages.length * 3;
  const xref = length;
  write(`xref\n0 ${String(size)}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id += 1) {
    write(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${String(size)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(chunks));
}

export type MaskedPdf =
  | { ok: true; bytes: Uint8Array; pages: number; regionsMasked: number }
  | { ok: false; reason: FileRejectReason };

/**
 * A vault PDF with every page masked: more than `KNOWLEDGE_PDF_MAX_PAGES` pages is refused
 * (`file_pdf_too_many_pages`), a PDF PDFium cannot open `file_unreadable`, and a page whose
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
    bytes: await jpegsToPdf(masked),
    pages: masked.length,
    regionsMasked,
  };
}
