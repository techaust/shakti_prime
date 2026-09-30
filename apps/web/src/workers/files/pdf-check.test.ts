import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkPdf, MAX_INFLATED_BYTES } from './pdf-check';

const pdf = (...parts: (string | Buffer)[]): Buffer =>
  Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    ...parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))),
    Buffer.from('\ntrailer\n%%EOF\n'),
  ]);

/** A stream object with the dictionary entries given and these bytes as its data. */
function stream(dictionary: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`5 0 obj\n<< ${dictionary} /Length ${String(data.length)} >>\nstream\n`),
    data,
    Buffer.from('\nendstream\nendobj\n'),
  ]);
}

const flate = (content: string | Buffer): Buffer =>
  stream('/Type /ObjStm /Filter /FlateDecode', deflateSync(content));

const UNREADABLE = { ok: false, reason: 'file_unreadable' };
const ACTIVE = { ok: false, reason: 'file_pdf_active_content' };

describe('the PDF check', () => {
  it('passes a plain document, an unfiltered stream and a bare Flate stream', () => {
    expect(checkPdf(pdf('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj'))).toEqual({
      ok: true,
    });
    expect(checkPdf(pdf(stream('', Buffer.from('BT /F1 12 Tf (Quote) Tj ET'))))).toEqual({
      ok: true,
    });
    expect(checkPdf(pdf(flate('<< /Type /Page /Contents 6 0 R >>')))).toEqual({ ok: true });
  });

  it('skips an image whatever its filter, since its bytes are only ever pixels', () => {
    const jpeg = stream(
      '/Type /XObject /Subtype /Image /Filter /DCTDecode',
      Buffer.from([0xff, 0xd8, 0x28, 0x29]),
    );
    expect(checkPdf(pdf(jpeg))).toEqual({ ok: true });
  });

  it.each([
    ['a script', '<< /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >>'],
    ['a short script name', '<< /Names << /JS 7 0 R >> >>'],
    ['a launch action', '<< /S /Launch /F (cmd.exe) >>'],
    ['an open action that launches', '<< /OpenAction << /S /Launch /F (x) >> >>'],
    ['an embedded file', '<< /Type /EmbeddedFile /Length 10 >>'],
    ['a list of embedded files', '<< /Names << /EmbeddedFiles 8 0 R >> >>'],
    ['a form script', '<< /AcroForm << /XFA 9 0 R >> >>'],
    ['rich media', '<< /Subtype /RichMedia >>'],
    ['an additional action', '<< /AA << /O 7 0 R >> >>'],
    ['an escaped name', '<< /S /J#61vaScript /JS (x) >>'],
    ['an escaped short name', '<< /#4A#53 (x) >>'],
  ])('refuses %s', (_, body) => {
    expect(checkPdf(pdf(body))).toEqual(ACTIVE);
  });

  it('finds a name hidden in a compressed object stream', () => {
    expect(checkPdf(pdf(flate('<< /S /Launch /F (x) >>')))).toEqual(ACTIVE);
  });

  it('does not take a longer name for one it refuses', () => {
    expect(checkPdf(pdf('<< /JSONData 1 /Launcher 2 /JavaScripts 3 /AAB 4 >>'))).toEqual({
      ok: true,
    });
  });

  it('refuses a file without the header or the end marker', () => {
    expect(checkPdf(Buffer.from('<html>%PDF-1.7 %%EOF'))).toEqual(UNREADABLE);
    expect(checkPdf(Buffer.from('%PDF-1.7\n1 0 obj << >> endobj'))).toEqual(UNREADABLE);
    expect(checkPdf(new Uint8Array(0))).toEqual(UNREADABLE);
  });

  describe('fails closed on a stream it cannot read', () => {
    it('refuses a stream that unpacks past the budget', () => {
      const bomb = flate(Buffer.alloc(MAX_INFLATED_BYTES + 1, 0x20));
      expect(checkPdf(pdf(bomb))).toEqual(UNREADABLE);
    });

    it('refuses two streams that pass the budget together', () => {
      const half = Buffer.alloc(MAX_INFLATED_BYTES / 2 + 1, 0x20);
      expect(checkPdf(pdf(flate(half), flate(half)))).toEqual(UNREADABLE);
    });

    it('refuses decode parameters, even in a nested dictionary, and a predictor', () => {
      const nested = stream(
        '/Type /ObjStm /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 5 >>',
        deflateSync('<< /Type /Page >>'),
      );
      expect(checkPdf(pdf(nested))).toEqual(UNREADABLE);
      const predictor = stream('/Filter /FlateDecode /Predictor 2', deflateSync('<< >>'));
      expect(checkPdf(pdf(predictor))).toEqual(UNREADABLE);
    });

    it('refuses another filter, a chain and a filter it cannot read', () => {
      const hex = Buffer.from(Buffer.from('<< /Type /Page >>').toString('hex'));
      expect(checkPdf(pdf(stream('/Filter /ASCIIHexDecode', hex)))).toEqual(UNREADABLE);
      expect(
        checkPdf(pdf(stream('/Filter [/ASCIIHexDecode /FlateDecode]', deflateSync('x')))),
      ).toEqual(UNREADABLE);
      expect(checkPdf(pdf(stream('/Filter [/FlateDecode', deflateSync('x'))))).toEqual(UNREADABLE);
      // An object stream labelled as an image is still read as what it is.
      expect(
        checkPdf(pdf(stream('/Type /ObjStm /Subtype /Image /Filter /ASCIIHexDecode', hex))),
      ).toEqual(UNREADABLE);
    });

    it('refuses a Flate stream cut short or damaged', () => {
      const whole = deflateSync('<< /Type /Page /Contents 6 0 R >>');
      const cut = whole.subarray(0, whole.length - 6);
      expect(checkPdf(pdf(stream('/Filter /FlateDecode', cut)))).toEqual(UNREADABLE);
      expect(checkPdf(pdf(stream('/Filter /FlateDecode', Buffer.from('abcd'))))).toEqual(
        UNREADABLE,
      );
    });

    it('refuses a stream without its dictionary or its end', () => {
      expect(checkPdf(pdf('5 0 obj\nstream\nabc\nendstream\nendobj'))).toEqual(UNREADABLE);
      expect(checkPdf(pdf('5 0 obj\n<< /Length 3 >>\nstream\nabc'))).toEqual(UNREADABLE);
    });
  });
});
