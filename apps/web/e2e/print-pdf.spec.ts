import { expect, projectName, test } from './support/fixtures';
import { longQuote, pdfPages, printQuotePdf } from './support/quote-pdf';

/**
 * The PDF itself rather than the template's page (ADR 0009, P4 review L7): Chromium's footer
 * (the brand, the quote number and "Page n of m") and where the page breaks are only in the PDF.
 * A fixed quotation long enough for two pages is printed through the render worker's template
 * and renderer, each page is drawn by PDFium, and the pictures are compared with their baselines.
 */
const PAGE_DIFF = {
  // PDFium draws the same PDF the same way each time; a few pixels allow for a Chromium patch
  // release moving an edge, while a changed word in the 8 pt footer differs in far more.
  maxDiffPixels: 40,
  threshold: 0.1,
};

test.describe('the quotation as a PDF, light only', () => {
  test.beforeEach(() => {
    test.skip(projectName() !== 'desktop-light', 'printed documents are light only');
    // As `snap`: pictures are compared only on Linux, where the baselines are made.
    test.skip(process.platform !== 'linux', 'PDF pages are compared only on Linux');
  });

  test('a long quotation breaks onto a second page, and each page has the footer', async () => {
    const pages = await pdfPages(await printQuotePdf(longQuote()));

    expect(pages).toHaveLength(2);
    for (const [i, page] of pages.entries()) {
      expect.soft(page.text).toContain('Agro Solar Hub · ASH/QT/2026-27/000418');
      expect.soft(page.text).toContain(`Page ${String(i + 1)} of 2`);
      expect.soft(page.png).toMatchSnapshot(`print-quote-pdf-page-${String(i + 1)}.png`, PAGE_DIFF);
    }
  });
});
