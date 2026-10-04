// Headless Chromium rendering for PDFs and labels (BLUEPRINT §5, ARCHITECTURE §9, ADR 0009).
// One browser per worker process, kept warm between jobs; one page per document. The page may not
// reach the network: templates carry everything inline, and a customer's text inside a template
// must never be able to make the renderer fetch anything.
import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Page,
} from 'playwright-core';
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
  /** False once the browser has gone away; a shared renderer is then launched again. */
  connected(): boolean;
  close(): Promise<void>;
}

export interface PrintRendererOptions {
  /** A Chromium binary to use instead of Playwright's downloaded build (for a worker image). */
  executablePath?: string;
  /** Further command-line switches for Chromium (the serverless build's own). */
  args?: string[];
}

/**
 * Where Chromium comes from (ADR 0009): on Vercel, the serverless build `@sparticuz/chromium`,
 * unpacked into the function's temporary folder on its first launch, with its recommended
 * switches and no graphics stack (a PDF needs none); everywhere else, the Chromium Playwright
 * installed on the machine (`playwright-core install chromium-headless-shell`, and the Playwright
 * image in CI). Nothing is downloaded while a document renders.
 */
export async function chromiumForRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PrintRendererOptions> {
  if (env.VERCEL !== '1') return {};
  const { default: serverless } = await import('@sparticuz/chromium');
  serverless.setGraphicsMode = false;
  return { executablePath: await serverless.executablePath(), args: serverless.args };
}

/** Pages in a PDF Chromium wrote: one `/Type /Page` object each (not `/Pages`). */
export function pageCount(pdf: Uint8Array): number {
  return (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
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
  const launch: LaunchOptions = {
    headless: true,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    ...(options.args ? { args: options.args } : {}),
  };
  const browser: Browser = await chromium.launch(launch);
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

    connected() {
      return browser.isConnected();
    },

    async close() {
      await browser.close();
    },
  };
}

/** The process's warm renderer, kept across jobs and in the dev server across reloads. */
const shared = globalThis as typeof globalThis & {
  __shaktiPrintRenderer?: Promise<PrintRenderer> | undefined;
};

/**
 * The renderer every job of this process shares: launched on first use with the runtime's
 * Chromium, and launched again when the browser has gone away (a crash, a closed process).
 */
export async function sharedPrintRenderer(): Promise<PrintRenderer> {
  const current = shared.__shaktiPrintRenderer;
  if (current !== undefined) {
    const renderer = await current.catch(() => undefined);
    if (renderer?.connected() === true) return renderer;
  }
  const next = chromiumForRuntime().then((options) => createPrintRenderer(options));
  shared.__shaktiPrintRenderer = next;
  try {
    return await next;
  } catch (error) {
    shared.__shaktiPrintRenderer = undefined;
    throw error;
  }
}
