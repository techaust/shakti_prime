// Structure tests for the print templates. They run without Chromium; the rendered PDFs,
// page counts and QR scans are checked by `pnpm spike:print`.
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import { bankBlock, companyBlock, imageSource } from './company';
import { printCopy } from './copy';
import { spikeCompany, spikeLabels, spikeQuote } from './fixtures/spike-documents';
import { formatRupees } from './format';
import { escapeHtml, html, trusted } from './html';
import { renderLabelsHtml } from './label-template';
import { renderLetterheadProof } from './letterhead-proof-template';
import { qrMatrix, qrSvg } from './qr';
import { renderQuote } from './quote-template';
import { baseCss, lightColor } from './styles';

describe('html', () => {
  it('escapes interpolated text and keeps trusted markup', () => {
    const name = '<script>alert(1)</script> & "Sons"';
    expect(html`<p>${name}</p>`.value).toBe(`<p>${escapeHtml(name)}</p>`);
    expect(html`<p>${trusted('<b>ok</b>')}</p>`.value).toBe('<p><b>ok</b></p>');
    // Prettier lays out `html` templates like HTML, so compare without the space between tags.
    expect(
      html`<ul>
        ${['a', 'b'].map((x) => html`<li>${x}</li>`)}
      </ul>`.value.replace(/>\s+</g, '><'),
    ).toBe('<ul><li>a</li><li>b</li></ul>');
  });
});

describe('print styles', () => {
  it('carry Inter inline and only the light theme', () => {
    const css = baseCss();
    expect(css).toContain('font-family:Inter');
    expect(css).toMatch(/src:url\(data:font\/woff2;base64,/);
    expect(css).not.toMatch(/https?:/);
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).toContain(`--bg:${lightColor('bg')};`);
    expect(css).toContain(`--text:${lightColor('text')};`);
    expect(css).toContain('color-scheme:light');
  });

  it('leave the font to the viewer for an on-screen preview, still light', async () => {
    expect(baseCss({ fonts: 'viewer' })).not.toContain('@font-face');
    expect(baseCss({ fonts: 'viewer' })).toContain(`--bg:${lightColor('bg')};`);
    const { html: page, options } = await renderQuote(spikeQuote(1), { fonts: 'viewer' });
    expect(page).not.toContain('@font-face');
    expect(page).toContain(en.print.quote.title);
    expect(options.footerTemplate).not.toContain('@font-face');
    const labels = await renderLabelsHtml(spikeLabels(1), '100x50', { fonts: 'viewer' });
    expect(labels).not.toContain('@font-face');
  });
});

describe('quotation template', () => {
  it('prints the quotation from the catalogue words and the given amounts', async () => {
    const quote = spikeQuote(1);
    const { html: page, options } = await renderQuote(quote);
    expect(page).toContain(en.print.quote.title);
    expect(page).toContain(quote.number);
    expect(page).toContain('27-09-2026');
    expect(page).toContain(formatRupees(quote.totals.total));
    expect(page).toContain(quote.totals.totalInWords);
    for (const line of quote.lines) expect(page).toContain(escapeHtml(line.description));
    expect(page).toMatch(/http-equiv="Content-Security-Policy"\s+content="default-src 'none'/);
    expect(options.format).toBe('A4');
    expect(options.margin).toMatchObject({ left: '15mm', right: '15mm' });
    expect(options.footerTemplate).toContain('<span class="pageNumber"></span>');
    expect(options.footerTemplate).toContain('<span class="totalPages"></span>');
  });

  it('escapes a customer name instead of running it', async () => {
    const quote = spikeQuote(1);
    quote.customer.name = '<img src=x onerror=alert(1)>';
    const { html: page } = await renderQuote(quote);
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('prints the selling company’s letterhead, logo and bank account, and no other company', async () => {
    const images = {
      logo: { contentType: 'image/png' as const, base64: 'AQID' },
      letterhead: { contentType: 'image/jpeg' as const, base64: 'BAUG' },
    };
    const quote = { ...spikeQuote(1), company: spikeCompany(images) };
    const { html: page, options } = await renderQuote(quote);
    expect(page).toContain('src="data:image/jpeg;base64,BAUG"');
    expect(page).toContain('src="data:image/png;base64,AQID"');
    expect(page.indexOf('BAUG')).toBeLessThan(page.indexOf('AQID'));
    const bank = quote.company.bank;
    if (bank === null) throw new Error('the fixture has an account');
    for (const value of Object.values(bank)) expect(page).toContain(escapeHtml(value));
    expect(page).toContain(en.print.company.bankHeading);
    expect(page).toContain(quote.company.gstin ?? '');
    expect(options.footerTemplate).toContain(quote.company.brandName);
    // Another company's details appear nowhere on it.
    expect(page).not.toContain('Shakti Motor Pumps');
    const without = await renderQuote({ ...quote, company: { ...quote.company, bank: null } });
    expect(without.html).not.toContain(en.print.company.bankHeading);
    expect(without.html).not.toContain(bank.accountNumber);
  });

  it('draws the QR code for the quotation link', async () => {
    const quote = spikeQuote(1);
    const { html: page } = await renderQuote(quote);
    expect(page).toContain(await qrSvg(quote.link));
  });
});

describe('labels', () => {
  it('prints one label per entry with its own QR code', async () => {
    const labels = spikeLabels(3);
    const page = await renderLabelsHtml(labels, '50x25');
    expect(page.match(/<div class="label">/g)).toHaveLength(3);
    expect(page).toContain('@page{size:50mm 25mm;margin:0;}');
    for (const label of labels) {
      expect(page).toContain(label.serial);
      expect(page).toContain(await qrSvg(label.qrPayload));
    }
    expect(page).toContain(en.print.label.serial);
  });

  it('sizes the large label at 100 by 50 mm', async () => {
    const page = await renderLabelsHtml(spikeLabels(1), '100x50');
    expect(page).toContain('@page{size:100mm 50mm;margin:0;}');
  });
});

describe('qr', () => {
  it('encodes the payload the label was given', () => {
    const payload = spikeLabels(1)[0]?.qrPayload ?? '';
    const matrix = qrMatrix(payload);
    const direct = QRCode.create(payload, { errorCorrectionLevel: 'M' }).modules;
    expect(matrix).toHaveLength(direct.size);
    expect(matrix.flat().map((dark) => (dark ? 1 : 0))).toEqual(Array.from(direct.data));
  });

  it('draws dark modules in the text colour on the background colour', async () => {
    const svg = await qrSvg('https://shaktiprime.com/s/ASH26C000001');
    expect(svg).toContain(lightColor('text'));
    expect(svg).toContain(lightColor('bg'));
  });
});

describe('the company block', () => {
  it('inlines only images, never another address', () => {
    expect(imageSource({ contentType: 'image/png', base64: 'AQID' })).toBe(
      'data:image/png;base64,AQID',
    );
    expect(() => imageSource({ contentType: 'text/html' as 'image/png', base64: 'AQID' })).toThrow(
      RangeError,
    );
    expect(() => imageSource({ contentType: 'image/png', base64: '"><script>' })).toThrow(
      RangeError,
    );
  });

  it('escapes a company name and leaves out what is not recorded', () => {
    const t = printCopy();
    const company = {
      ...spikeCompany(),
      legalName: '<b>Agro</b> & Sons',
      gstin: null,
      bank: null,
    };
    const block = companyBlock(company, t).value;
    expect(block).toContain('&lt;b&gt;Agro&lt;/b&gt; &amp; Sons');
    expect(block).not.toContain(en.print.company.gstin);
    expect(block).not.toContain('<img');
    expect(bankBlock(company, t)).toBe('');
  });
});

describe('the proof page', () => {
  it('prints every detail as documents do, and says which are not recorded yet', () => {
    const company = spikeCompany({ logo: { contentType: 'image/png', base64: 'AQID' } });
    const { html: page, options } = renderLetterheadProof({ company, printedOn: '2026-10-04' });
    expect(page).toContain(en.print.proof.heading);
    expect(page).toContain(escapeHtml(company.legalName));
    for (const line of company.addressLines) expect(page).toContain(escapeHtml(line));
    expect(page).toContain(company.gstin ?? '');
    const bank = company.bank;
    if (bank === null) throw new Error('the fixture has an account');
    for (const value of Object.values(bank)) expect(page).toContain(escapeHtml(value));
    expect(page).toContain(en.print.proof.printedBeside);
    // No letterhead in the fixture: the list says so.
    expect(page).toContain(en.print.proof.missing);
    expect(page).not.toContain('class="letterhead-strip"');
    expect(page).toMatch(/http-equiv="Content-Security-Policy"\s+content="default-src 'none'/);
    expect(options).toMatchObject({ format: 'A4', margin: { left: '15mm', right: '15mm' } });
    expect(options.footerTemplate).toContain('04-10-2026');
    expect(options.footerTemplate).toContain(escapeHtml(company.brandName));
  });

  it('marks the GSTIN, address and account not recorded when they are not', () => {
    const company = { ...spikeCompany(), addressLines: [], gstin: null, bank: null };
    const { html: page } = renderLetterheadProof({ company, printedOn: '2026-10-04' });
    // Letterhead, logo, address, GSTIN and the four bank lines.
    expect(page.match(new RegExp(en.print.proof.missing, 'g'))).toHaveLength(8);
    expect(page).not.toContain(en.print.company.bankHeading);
  });
});
