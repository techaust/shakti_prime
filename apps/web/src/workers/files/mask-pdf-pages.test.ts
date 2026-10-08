import { KNOWLEDGE_PDF_MAX_PAGES } from '@shakti/contracts';
import { memoryFileStore } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  AADHAAR,
  AADHAAR_SPACED as SPACED,
  coveringMasker,
  pdfOf,
  scanOf,
} from '../../../tests/support/pdf-fixtures';
import type { DocumentMasker, MaskOutcome } from '../ocr/mask-document';
import { vaultMasker } from '../ocr/vault-masker';
import {
  deleteMaskedPages,
  maskNextPdfPage,
  partsPrefix,
  type MaskStepDeps,
} from './mask-pdf-pages';
import { checkPdf } from './pdf-check';
import { countPdfPages, renderMaskedPages } from './pdf-pages';

// The vault's PDF masking, one page per delivery (docs/03-roadmap-appendix/phase1.md §8.4): the next
// page is drawn, run through the masking step and kept in the store; the last page ends in the
// masked PDF. Every number here is made up.

const KEY = '1/knowledge/0198a000-0000-7000-8000-000000000001.pdf';

function setup(masker: DocumentMasker = coveringMasker(), extra: Partial<MaskStepDeps> = {}) {
  const store = memoryFileStore('test-bucket');
  const deps: MaskStepDeps = {
    store,
    masker: () => Promise.resolve(masker),
    elapsed: () => 0,
    ...extra,
  };
  return { store, deps };
}

const input = (bytes: Uint8Array, maskedPages?: number) => ({
  bytes,
  uploadKey: KEY,
  maskedPages,
});

describe('masking a vault PDF one page per delivery', () => {
  it('masks a 3-page PDF over three deliveries and keeps the masked PDF only at the last', async () => {
    const original = await pdfOf([`Aadhaar ${SPACED}`, 'Second page', 'Third page']);
    const seen: Buffer[] = [];
    const { store, deps } = setup(coveringMasker(seen));

    const first = await maskNextPdfPage(input(original), deps);
    expect(first).toMatchObject({ kind: 'more', done: 1, pages: 3 });
    expect(seen).toHaveLength(1);
    const second = await maskNextPdfPage(input(original, 1), deps);
    expect(second).toMatchObject({ kind: 'more', done: 2, pages: 3 });
    expect(seen).toHaveLength(2);
    const last = await maskNextPdfPage(input(original, 2), deps);
    if (last.kind !== 'complete') throw new Error(`expected the masked PDF, got ${last.kind}`);
    expect(seen).toHaveLength(3);
    expect(last).toMatchObject({ pages: 3, regionsMasked: 3 });

    // The masking step saw each page as a picture, never the PDF.
    expect(seen.every((page) => page.subarray(1, 4).toString() === 'PNG')).toBe(true);
    // What is kept is a valid PDF of three pages that holds none of the original's text.
    expect(checkPdf(last.bytes)).toEqual({ ok: true });
    expect(await countPdfPages(last.bytes)).toBe(3);
    expect(Buffer.from(last.bytes).includes(Buffer.from(SPACED))).toBe(false);
    expect(Buffer.from(last.bytes).includes(Buffer.from('Second page'))).toBe(false);
    expect(await renderMaskedPages(last.bytes)).toHaveLength(3);
    // The pages waited in the store beside the upload, and the caller deletes them.
    expect([...store.objects.keys()].every((k) => k.startsWith(`${partsPrefix(KEY)}/`))).toBe(true);
    expect(store.objects.size).toBe(6);
    await deleteMaskedPages(store, KEY);
    expect(store.objects.size).toBe(0);
  });

  it('does nothing for a delivery of a page that is already kept', async () => {
    const original = await pdfOf(['One', 'Two', 'Three']);
    const seen: Buffer[] = [];
    const { deps } = setup(coveringMasker(seen));
    await maskNextPdfPage(input(original), deps);
    await maskNextPdfPage(input(original, 1), deps);
    expect(seen).toHaveLength(2);

    // The delivery for the first page arrives again, as QStash does when an answer is lost.
    expect(await maskNextPdfPage(input(original, 1), deps)).toEqual({
      kind: 'stale',
      done: 2,
      pages: 3,
    });
    expect(seen).toHaveLength(2);
  });

  it('keeps the first bytes written for a page, so two deliveries on one page cannot both write it', async () => {
    const original = await pdfOf(['One', 'Two']);
    const { store, deps } = setup();
    await maskNextPdfPage(input(original), deps);
    const key = `${partsPrefix(KEY)}/p0001.jpg`;
    const before = store.objects.get(key)?.bytes;
    await store.put(key, new Uint8Array([1, 2, 3]), 'image/jpeg');
    expect(store.objects.get(key)?.bytes).toBe(before);
  });

  it('assembles the PDF when every page was kept but the last delivery died before it', async () => {
    const original = await pdfOf(['One', 'Two']);
    const seen: Buffer[] = [];
    const { deps } = setup(coveringMasker(seen));
    await maskNextPdfPage(input(original), deps);
    // The second page is kept; the delivery then died. Its retry names one page kept.
    const second = await maskNextPdfPage(input(original, 1), deps);
    expect(second.kind).toBe('complete');
    const retry = await maskNextPdfPage(input(original, 1), deps);
    expect(retry.kind).toBe('complete');
    expect(seen).toHaveLength(2);
  });

  it('takes a page back when asked, so the next delivery does it over', async () => {
    const original = await pdfOf(['One', 'Two']);
    const seen: Buffer[] = [];
    const { deps } = setup(coveringMasker(seen));
    const first = await maskNextPdfPage(input(original), deps);
    if (first.kind !== 'more') throw new Error('expected one page kept');
    await first.undo();
    expect(await maskNextPdfPage(input(original), deps)).toMatchObject({ kind: 'more', done: 1 });
    expect(seen).toHaveLength(2);
  });

  it('refuses the file when a page runs past its time, closes the busy masking step and masks no more', async () => {
    const original = await pdfOf(['One', 'Two']);
    const discard = vi.fn(() => Promise.resolve());
    const slow: DocumentMasker = {
      mask: () => new Promise<MaskOutcome>(() => undefined),
      close: () => Promise.resolve(),
    };
    const { deps } = setup(slow, {
      limits: { startMs: 1_000, maskMs: 60 },
      discardMasker: discard,
    });
    const started = Date.now();
    expect(await maskNextPdfPage(input(original), deps)).toEqual({
      kind: 'refused',
      reason: 'file_pdf_page_too_dense',
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it('refuses a page that is not even drawn in time without masking it', async () => {
    const seen: Buffer[] = [];
    const { deps } = setup(coveringMasker(seen), { elapsed: () => 20_000 });
    expect(await maskNextPdfPage(input(await pdfOf(['One'])), deps)).toEqual({
      kind: 'refused',
      reason: 'file_pdf_page_too_dense',
    });
    expect(seen).toHaveLength(0);
  });

  it('refuses a PDF of more pages than the vault reads, before any page is masked', async () => {
    const seen: Buffer[] = [];
    const { deps, store } = setup(coveringMasker(seen));
    const many = await pdfOf(
      Array.from({ length: KNOWLEDGE_PDF_MAX_PAGES + 1 }, (_, i) => `Page ${String(i)}`),
    );
    expect(await maskNextPdfPage(input(many), deps)).toEqual({
      kind: 'refused',
      reason: 'file_pdf_too_many_pages',
    });
    expect(seen).toHaveLength(0);
    expect(store.objects.size).toBe(0);
    const exactly = await pdfOf(
      Array.from({ length: KNOWLEDGE_PDF_MAX_PAGES }, (_, i) => `Page ${String(i)}`),
    );
    expect(await maskNextPdfPage(input(exactly), deps)).toMatchObject({
      kind: 'more',
      pages: KNOWLEDGE_PDF_MAX_PAGES,
    });
  });

  it('keeps nothing more when a page’s numbers cannot be found, and calls a broken PDF unreadable', async () => {
    const refusing: DocumentMasker = {
      mask: () => Promise.resolve({ status: 'needs_review' } as unknown as MaskOutcome),
      close: () => Promise.resolve(),
    };
    expect(await maskNextPdfPage(input(await pdfOf(['One'])), setup(refusing).deps)).toEqual({
      kind: 'refused',
      reason: 'file_mask_failed',
    });
    expect(
      await maskNextPdfPage(input(new TextEncoder().encode('%PDF-1.7 broken')), setup().deps),
    ).toEqual({ kind: 'refused', reason: 'file_unreadable' });
  });

  it('does not blame the file when the masking step itself fails', async () => {
    const failing: DocumentMasker = {
      mask: () => Promise.reject(new Error('the OCR engine stopped')),
      close: () => Promise.resolve(),
    };
    await expect(maskNextPdfPage(input(await pdfOf(['One'])), setup(failing).deps)).rejects.toThrow(
      'the OCR engine stopped',
    );
  });
});

// The real masking step needs the English OCR model on this machine (`OCR_LANG_PATH`, fetched once
// by `pnpm --filter web spike:ocr`); a machine without the folder cannot run this one case.
describe.skipIf(process.env.OCR_LANG_PATH === undefined || process.env.OCR_LANG_PATH === '')(
  'masking a scanned vault PDF with the real masking step',
  () => {
    it('hides the Aadhaar number of an image-only PDF', async () => {
      const masker = await vaultMasker();
      const { deps } = setup(masker);
      const masked = await maskNextPdfPage(input(await scanOf(`Aadhaar No ${SPACED}`)), deps);
      if (masked.kind !== 'complete') throw new Error(`expected a masked PDF, got ${masked.kind}`);
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
