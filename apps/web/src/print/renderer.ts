// Headless Chromium rendering for PDFs and labels (BLUEPRINT §5, ARCHITECTURE §9, ADR 0009 to
// come). One browser per worker process; one page per document. The page may not reach the
// network: templates carry everything inline, and a customer's text inside a template must
// never be able to make the renderer fetch anything.
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { LABEL_SIZES, type LabelSize } from './label-template';

export interface PdfOptions {
  format?: 'A4';
  width?: string;
  height?: string;
  margin?: { top: string; right: string; bottom: string; left: string };
  headerTemplate?: string;
  footerTemplate?: string;
}

export interface PrintRenderer {
  /** A PDF of `html`; header and footer templates turn on page numbering. */
  renderPdf(html: string, options?: PdfOptions): Promise<Buffer>;
  /** A PDF with one label per page, at the label stock's size. */
  renderLabel(html: string, size: LabelSize): Promise<Buffer>;
  /** A PNG of the first element matching `selector`, at `dpi`, for checking a render. */
  renderImage(html: string, selector: string, dpi: number): Promise<Buffer>;
  close(): Promise<void>;
}

export interface PrintRendererOptions {
  /** A Chromium binary to use instead of Playwright's downloaded build (for a worker image). */
  executablePath?: string;
}

async function isolated(context: BrowserContext): Promise<void> {
  // Anything that is not an inline data URL is refused.
  await context.route(/^(?!data:)/, (route) => route.abort('blockedbyclient'));
}

async function load(context: BrowserContext, html: string): Promise<Page> {
  const page = await context.newPage();
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.setContent(html, { waitUntil: 'load' });
  // The fonts are inline, but the PDF must not be cut before they are ready.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  return page;
}

export async function createPrintRenderer(
  options: PrintRendererOptions = {},
): Promise<PrintRenderer> {
  const browser: Browser = await chromium.launch({
    headless: true,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
  });
  const context = await browser.newContext({ colorScheme: 'light', offline: true });
  await isolated(context);
  const imageContexts = new Map<number, BrowserContext>();

  return {
    async renderPdf(html, pdf = {}) {
      const page = await load(context, html);
      try {
        const footer = pdf.footerTemplate !== undefined || pdf.headerTemplate !== undefined;
        return await page.pdf({
          printBackground: true,
          ...(pdf.format ? { format: pdf.format } : {}),
          ...(pdf.width ? { width: pdf.width } : {}),
          ...(pdf.height ? { height: pdf.height } : {}),
          ...(pdf.margin ? { margin: pdf.margin } : {}),
          displayHeaderFooter: footer,
          ...(footer
            ? {
                headerTemplate: pdf.headerTemplate ?? '<span></span>',
                footerTemplate: pdf.footerTemplate ?? '<span></span>',
              }
            : {}),
        });
      } finally {
        await page.close();
      }
    },

    async renderLabel(html, size) {
      const { widthMm, heightMm } = LABEL_SIZES[size];
      const page = await load(context, html);
      try {
        return await page.pdf({
          width: `${widthMm}mm`,
          height: `${heightMm}mm`,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
          printBackground: true,
          preferCSSPageSize: true,
        });
      } finally {
        await page.close();
      }
    },

    async renderImage(html, selector, dpi) {
      let imageContext = imageContexts.get(dpi);
      if (!imageContext) {
        imageContext = await browser.newContext({
          colorScheme: 'light',
          offline: true,
          deviceScaleFactor: dpi / 96,
        });
        await isolated(imageContext);
        imageContexts.set(dpi, imageContext);
      }
      const page = await load(imageContext, html);
      try {
        return await page.locator(selector).first().screenshot({ animations: 'disabled' });
      } finally {
        await page.close();
      }
    },

    async close() {
      await browser.close();
    },
  };
}
