import { verhoeffCheckDigit } from '@shakti/domain';
import sharp from 'sharp';
import { pdfOf } from '../../e2e/support/pdf';
import { jpegsToPdf, renderMaskedPages } from '../../src/workers/files/pdf-pages';
import type { DocumentMasker, MaskOutcome } from '../../src/workers/ocr/mask-document';

export { pdfOf };

// PDFs and masking steps for the vault's tests. Every number here is made up.

/** A made-up Aadhaar number whose last digit is the Verhoeff check digit, as a real one's is. */
const BASE = '23456789012';
export const AADHAAR = `${BASE}${verhoeffCheckDigit(BASE)}`;
export const AADHAAR_SPACED = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

/** A PDF whose one page is a picture only, so no text layer holds anything. */
export async function scanOf(text: string): Promise<Uint8Array> {
  const jpeg = await renderMaskedPages(await pdfOf([text]));
  return jpegsToPdf([{ jpeg: jpeg[0] ?? new Uint8Array(), widthPt: 612, heightPt: 792 }]);
}

/** A masking step that covers a corner of the page and keeps what it was given for the test. */
export function coveringMasker(seen: Buffer[] = []): DocumentMasker {
  return {
    async mask(photo): Promise<MaskOutcome> {
      seen.push(Buffer.from(photo));
      const cover = await sharp({
        create: { width: 40, height: 40, channels: 3, background: '#000000' },
      })
        .png()
        .toBuffer();
      const image = await sharp(photo)
        .composite([{ input: cover, left: 0, top: 0 }])
        .jpeg()
        .toBuffer();
      photo.fill(0);
      return { status: 'masked', image, rects: 1 } as unknown as MaskOutcome;
    },
    close: () => Promise.resolve(),
  };
}
