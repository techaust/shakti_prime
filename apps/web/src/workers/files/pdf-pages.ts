import type { PDFiumDocument, PDFiumLibrary } from '@hyzyla/pdfium';
import sharp from 'sharp';

// A vault PDF is read as pictures, never as a PDF (docs/03-roadmap-appendix/phase1.md §8.4, docs/07-security.md
// §5): each page is drawn to an image, the image goes through the same masking step as a vault
// photo, and only the masked pages are kept (assembled into a PDF of pictures) and sent to a
// model. PDFium (WebAssembly) draws the pages; it is loaded on first use, never at import, so the
// build and every other worker start without it.

/** Pixels per inch a page is drawn at: enough for the OCR step to read body text. */
export const PDF_RENDER_DPI = 150;
/** A page larger than this many pixels is drawn smaller (a poster-sized page must not fill memory). */
const MAX_PAGE_PIXELS = 16_000_000;
/**
 * A page's longest side in pixels: Claude refuses a picture of more than 8,000 on a side, so a
 * banner-shaped page is drawn at a lower resolution instead of at 150 pixels an inch.
 */
export const MAX_PAGE_EDGE_PX = 7_000;
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

/** How many pixels a point is drawn as: 150 pixels an inch, less when the page would be too big. */
export function renderScale(widthPt: number, heightPt: number): number {
  const wanted = PDF_RENDER_DPI / POINTS_PER_INCH;
  const byArea = Math.sqrt(MAX_PAGE_PIXELS / Math.max(1, widthPt * heightPt));
  const byEdge = MAX_PAGE_EDGE_PX / Math.max(1, widthPt, heightPt);
  return Math.min(wanted, byArea, byEdge);
}

/**
 * Draws the pages one at a time (only one page's pixels are in memory at once) as PNG, or as
 * JPEG when asked, in reading order; `only` draws just the page at that position (from 0).
 */
export async function* renderPdfPages(
  bytes: Uint8Array,
  format: 'png' | 'jpeg',
  only?: number,
): AsyncGenerator<RenderedPage> {
  const { library, doc } = await openPdf(bytes);
  try {
    const count = doc.getPageCount();
    for (let i = only ?? 0; i < (only === undefined ? count : Math.min(count, only + 1)); i += 1) {
      const page = doc.getPage(i);
      const { originalWidth: widthPt, originalHeight: heightPt } = page.getOriginalSize();
      const drawn = await page.render({
        scale: renderScale(widthPt, heightPt),
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
