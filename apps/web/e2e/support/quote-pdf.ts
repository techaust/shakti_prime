import { readFileSync } from 'node:fs';
// eslint-disable-next-line no-restricted-syntax -- registerHooks only, to load the catalogue; no require() is built
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import type { PrintImage } from '../../src/print/company';
import { spikeCompany, spikeQuote } from '../../src/print/fixtures/spike-documents';
import type { QuotePrint } from '../../src/print/quote-template';
import { solidPng } from './png';

// A real quotation PDF for `print-pdf.spec.ts` (ADR 0009, P4 review L7): the quote template and
// the renderer the render worker uses (`src/workers/pdf/render-job.ts`), so the PDF's footer and
// its page break are compared, which the HTML snapshots of `print.spec.ts` cannot show.

/** The message catalogue the print module imports (`src/print/copy.ts`). */
const CATALOGUE = new URL('../../messages/en.json', import.meta.url).href;

/**
 * `src/print/copy.ts` imports the message catalogue as plain JSON, which Node refuses in the
 * Playwright runner without an import attribute (`next build`, vitest and tsx accept it). This
 * load step serves that one file as a module whose default export is its content, as those tools
 * do; every other file loads as before. It is registered by the first call below, before the
 * print module is imported, in the worker that prints.
 */
let catalogueAsModule = false;
function loadCatalogueAsModule(): void {
  if (catalogueAsModule) return;
  registerHooks({
    load(url, context, nextLoad) {
      if (url !== CATALOGUE) return nextLoad(url, context);
      const text = readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${text};`, shortCircuit: true };
    },
  });
  catalogueAsModule = true;
}

/** The print module's template and renderer, imported once the JSON step is in place. */
async function printModule() {
  loadCatalogueAsModule();
  const [template, renderer] = await Promise.all([
    import('../../src/print/quote-template'),
    import('../../src/print/renderer'),
  ]);
  return { renderQuote: template.renderQuote, ...renderer };
}

const picture = (width: number, height: number, colour: [number, number, number]): PrintImage => ({
  contentType: 'image/png',
  base64: solidPng(width, height, colour).toString('base64'),
});

/**
 * The fixed quotation: three sites of the spike's seven-line kit (21 lines, long enough to break
 * onto a second page), its fixed number, dates, customer and amounts, and the selling company
 * with a logo, a letterhead and a bank account in plain colours. Nothing reads the clock or makes
 * an id.
 */
export function longQuote(): QuotePrint {
  return {
    ...spikeQuote(3),
    company: spikeCompany({
      logo: picture(160, 160, [94, 106, 210]),
      letterhead: picture(1800, 200, [246, 246, 248]),
    }),
  };
}

/** `quote` printed as the render worker prints it: its template, then Chromium, always light. */
export async function printQuotePdf(quote: QuotePrint): Promise<Buffer> {
  const { renderQuote, createPrintRenderer, chromiumForRuntime } = await printModule();
  const document = await renderQuote(quote);
  const renderer = await createPrintRenderer(await chromiumForRuntime());
  try {
    return await renderer.renderPdf(document.html, document.options);
  } finally {
    await renderer.close();
  }
}

/** Pixels per inch a page is drawn at: the screen's 96, so A4 is 794 by 1123 like the HTML snapshots. */
const DPI = 96;
const POINTS_PER_INCH = 72;

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Red, green, blue and alpha pixels as an 8-bit RGB PNG (the page is opaque; alpha is dropped). */
function rgbaToPng(rgba: Uint8Array, width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    // Each row starts with filter type 0 (none), already zero.
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = y * stride + 1 + x * 3;
      raw[to] = rgba[from] ?? 0;
      raw[to + 1] = rgba[from + 1] ?? 0;
      raw[to + 2] = rgba[from + 2] ?? 0;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** One page of the PDF: its picture and the text PDFium reads from it. */
export interface PdfPage {
  png: Buffer;
  text: string;
}

/**
 * Every page drawn by PDFium (WebAssembly, as `src/workers/files/pdf-pages.ts` draws a vault
 * PDF) at 96 pixels an inch on white, as a PNG, with the page's text. The runner in the Linux
 * image loads nothing native, so the PNG is written here rather than by an image library.
 */
export async function pdfPages(pdf: Uint8Array): Promise<PdfPage[]> {
  const { PDFiumLibrary } = await import('@hyzyla/pdfium');
  const library = await PDFiumLibrary.init();
  try {
    const doc = await library.loadDocument(new Uint8Array(pdf));
    try {
      const pages: PdfPage[] = [];
      for (let i = 0; i < doc.getPageCount(); i += 1) {
        const page = doc.getPage(i);
        try {
          const drawn = await page.render({
            scale: DPI / POINTS_PER_INCH,
            colorSpace: 'RGBA',
            transparent: false,
            render: 'bitmap',
          });
          pages.push({
            png: rgbaToPng(drawn.data, drawn.width, drawn.height),
            text: page.getText(),
          });
        } finally {
          page.close();
        }
      }
      return pages;
    } finally {
      doc.destroy();
    }
  } finally {
    library.destroy();
  }
}
