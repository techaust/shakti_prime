// A PDF written byte by byte, shared by the journeys (which load nothing native, as `png.ts`
// says) and the vault's and customer documents' tests (`tests/support/pdf-fixtures.ts`).

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
