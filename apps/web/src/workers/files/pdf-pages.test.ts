import { KNOWLEDGE_PDF_MAX_PAGES } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  AADHAAR,
  AADHAAR_SPACED as SPACED,
  coveringMasker,
  pdfOf,
  scanOf,
} from '../../../tests/support/pdf-fixtures';
import type { DocumentMasker, MaskOutcome } from '../ocr/mask-document';
import { vaultMasker } from '../ocr/vault-masker';
import { checkPdf } from './pdf-check';
import { countPdfPages, maskPdf, renderMaskedPages, renderPdfPages } from './pdf-pages';

// The vault's PDF masking (docs/design/phase1.md §8.4): pages drawn by MuPDF, each through the
// masking step, only the masked pages kept. Every number here is made up.

describe('drawing a PDF as pictures', () => {
  it('counts the pages and draws each one, in order, as a PNG or a JPEG', async () => {
    const bytes = await pdfOf(['First page', 'Second page']);
    expect(await countPdfPages(bytes)).toBe(2);
    let drawn = 0;
    for await (const page of renderPdfPages(bytes, 'png')) {
      expect(Buffer.from(page.image).subarray(1, 4).toString()).toBe('PNG');
      expect([page.widthPt, page.heightPt]).toEqual([612, 792]);
      drawn += 1;
    }
    expect(drawn).toBe(2);
    const jpegs = await renderMaskedPages(bytes);
    expect(jpegs).toHaveLength(2);
    expect([...(jpegs[0] ?? []).subarray(0, 2)]).toEqual([0xff, 0xd8]);
  });

  it('refuses what is not a PDF', async () => {
    await expect(countPdfPages(new TextEncoder().encode('not a pdf at all'))).rejects.toThrow();
  });
});

describe('masking a vault PDF', () => {
  it('keeps a PDF of the masked pages only, one picture per page, with none of the original', async () => {
    const original = await pdfOf([`Aadhaar ${SPACED}`, 'Second page']);
    const seen: Buffer[] = [];
    const masked = await maskPdf(original, coveringMasker(seen));
    if (!masked.ok) throw new Error('expected a masked PDF');
    expect(masked).toMatchObject({ pages: 2, regionsMasked: 2 });
    // The masking step saw each page as a picture, never the PDF.
    expect(seen).toHaveLength(2);
    expect(seen.every((page) => page.subarray(1, 4).toString() === 'PNG')).toBe(true);
    // What is kept is a valid PDF of two pages that holds none of the original's text.
    expect(checkPdf(masked.bytes)).toEqual({ ok: true });
    expect(await countPdfPages(masked.bytes)).toBe(2);
    expect(Buffer.from(masked.bytes).includes(Buffer.from(SPACED))).toBe(false);
    expect(Buffer.from(masked.bytes).includes(Buffer.from('Second page'))).toBe(false);
    expect(await renderMaskedPages(masked.bytes)).toHaveLength(2);
  });

  it('refuses a PDF of more pages than the vault reads, before any page is masked', async () => {
    const seen: Buffer[] = [];
    const many = await pdfOf(
      Array.from({ length: KNOWLEDGE_PDF_MAX_PAGES + 1 }, (_, i) => `Page ${String(i)}`),
    );
    expect(await maskPdf(many, coveringMasker(seen))).toEqual({
      ok: false,
      reason: 'file_pdf_too_many_pages',
    });
    expect(seen).toHaveLength(0);
    const exactly = await pdfOf(
      Array.from({ length: KNOWLEDGE_PDF_MAX_PAGES }, (_, i) => `Page ${String(i)}`),
    );
    expect(await maskPdf(exactly, coveringMasker())).toMatchObject({
      ok: true,
      pages: KNOWLEDGE_PDF_MAX_PAGES,
    });
  });

  it('keeps nothing when a page’s numbers cannot be found, and calls a broken PDF unreadable', async () => {
    const refusing: DocumentMasker = {
      mask: () => Promise.resolve({ status: 'needs_review' } as unknown as MaskOutcome),
      close: () => Promise.resolve(),
    };
    expect(await maskPdf(await pdfOf(['One']), refusing)).toEqual({
      ok: false,
      reason: 'file_mask_failed',
    });
    expect(await maskPdf(new TextEncoder().encode('%PDF-1.7 broken'), coveringMasker())).toEqual({
      ok: false,
      reason: 'file_unreadable',
    });
  });

  it('does not blame the file when the masking step itself fails', async () => {
    const failing: DocumentMasker = {
      mask: () => Promise.reject(new Error('the OCR engine stopped')),
      close: () => Promise.resolve(),
    };
    await expect(maskPdf(await pdfOf(['One']), failing)).rejects.toThrow('the OCR engine stopped');
  });
});

// The real masking step needs the English OCR model on this machine (`OCR_LANG_PATH`, fetched once
// by `pnpm --filter web spike:ocr`); a machine without the folder cannot run this one case.
describe.skipIf(process.env.OCR_LANG_PATH === undefined || process.env.OCR_LANG_PATH === '')(
  'masking a scanned vault PDF with the real masking step',
  () => {
    it('hides the Aadhaar number of an image-only PDF', async () => {
      const masker = await vaultMasker();
      const masked = await maskPdf(await scanOf(`Aadhaar No ${SPACED}`), masker);
      if (!masked.ok) throw new Error(`expected a masked PDF, got ${masked.reason}`);
      expect(masked.regionsMasked).toBeGreaterThan(0);
      // Reading the masked page again finds none of the number's first eight digits.
      const [page] = await renderMaskedPages(masked.bytes);
      const { createWorker } = await import('tesseract.js');
      const reader = await createWorker('eng', 1, {
        langPath: process.env.OCR_LANG_PATH ?? '',
        cacheMethod: 'none',
        gzip: true,
      });
      try {
        const { data } = await reader.recognize(Buffer.from(page ?? []));
        const digits = data.text.replace(/\D/g, '');
        expect(digits).not.toContain(AADHAAR.slice(0, 8));
        expect(digits).not.toContain(AADHAAR.slice(4, 12));
      } finally {
        await reader.terminate();
      }
    }, 120_000);
  },
);
