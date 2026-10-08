import { verhoeffCheckDigit } from '@shakti/domain';
import sharp from 'sharp';
import { jpegsToPdf, renderMaskedPages } from '../../src/workers/files/pdf-pages';
import type { DocumentMasker, MaskOutcome } from '../../src/workers/ocr/mask-document';

// PDFs and masking steps for the vault's tests. Every number here is made up.

/** A made-up Aadhaar number whose last digit is the Verhoeff check digit, as a real one's is. */
const BASE = '23456789012';
export const AADHAAR = `${BASE}${verhoeffCheckDigit(BASE)}`;
export const AADHAAR_SPACED = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

/** A PDF with one page per text, the text drawn large in the built-in Helvetica. */
export function pdfOf(texts: readonly string[]): Promise<Uint8Array> {
  const kids = texts.map((_, i) => `${String(4 + i * 2)} 0 R`).join(' ');
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${String(texts.length)} /Kids [${kids}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  texts.forEach((text, i) => {
    const content = `BT /F1 30 Tf 40 700 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(5 + i * 2)} 0 R >>`,
      `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    );
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  const size = String(objects.length + 1);
  out += `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Promise.resolve(new TextEncoder().encode(out));
}

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
