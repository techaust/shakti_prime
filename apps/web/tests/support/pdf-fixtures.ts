import { verhoeffCheckDigit } from '@shakti/domain';
import sharp from 'sharp';
import type { DocumentMasker, MaskOutcome } from '../../src/workers/ocr/mask-document';

// PDFs and masking steps for the vault's tests. Every number here is made up.

/** A made-up Aadhaar number whose last digit is the Verhoeff check digit, as a real one's is. */
const BASE = '23456789012';
export const AADHAAR = `${BASE}${verhoeffCheckDigit(BASE)}`;
export const AADHAAR_SPACED = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

/** A PDF with one page per text, the text drawn large in the built-in Helvetica. */
export async function pdfOf(texts: readonly string[]): Promise<Uint8Array> {
  const mupdf = await import('mupdf');
  const doc = new mupdf.PDFDocument();
  const font = doc.addSimpleFont(new mupdf.Font('Helvetica'));
  texts.forEach((text, i) => {
    const page = doc.addPage(
      [0, 0, 612, 792],
      0,
      { Font: { F1: font } },
      `BT /F1 30 Tf 40 700 Td (${text}) Tj ET`,
    );
    doc.insertPage(i, page);
  });
  return doc.saveToBuffer('').asUint8Array().slice();
}

/** A PDF whose one page is a picture only, so no text layer holds anything. */
export async function scanOf(text: string): Promise<Uint8Array> {
  const mupdf = await import('mupdf');
  const source = new mupdf.PDFDocument(await pdfOf([text]));
  const pixmap = source.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB);
  const scan = new mupdf.PDFDocument();
  const image = scan.addImage(new mupdf.Image(pixmap.asJPEG(85)));
  scan.insertPage(
    0,
    scan.addPage(
      [0, 0, 612, 792],
      0,
      { XObject: { Page: image } },
      'q 612 0 0 792 0 0 cm /Page Do Q',
    ),
  );
  return scan.saveToBuffer('').asUint8Array().slice();
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
