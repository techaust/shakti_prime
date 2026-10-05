// A4 quotation (BLUEPRINT §8 quotes, DESIGN.md §6 Print templates): the selling company's
// letterhead, logo and bank account from the print loader (`company.ts`), light theme, 15 mm side
// margins, Inter embedded, the QR block bottom-right.
// Every amount arrives already computed by the domain (Price Master snapshot and the tax
// engine); this template only formats and places them.
import { bankBlock, companyBlock, companyCss, letterheadStrip, type CompanyPrint } from './company';
import { printCopy } from './copy';
import { formatAmount, formatDate, formatRupees } from './format';
import { html, trusted, type Html } from './html';
import { qrSvg } from './qr';
import { baseCss, interFontFaces, lightColor, type TemplateOptions } from './styles';
import type { PdfOptions } from './renderer';

export interface QuoteLinePrint {
  description: string;
  /** A second line under the item, such as the pump head or the panel make. */
  detail?: string;
  hsn: string;
  quantity: string;
  unit: string;
  /** Money strings from the quote DTO. */
  rate: string;
  gstRate: string;
  amount: string;
}

export interface QuoteTaxPrint {
  tax: 'CGST' | 'SGST' | 'IGST';
  /** The rate the amount was charged at; left out for a head summed over several rates. */
  rate?: string;
  amount: string;
}

export interface QuotePrint {
  /** The selling company, as the print loader reads it for the quote's company. */
  company: CompanyPrint;
  number: string;
  /** Calendar dates, "YYYY-MM-DD". */
  date: string;
  validUntil: string;
  customer: {
    name: string;
    addressLines: string[];
    phone?: string;
    gstin?: string;
    placeOfSupply: string;
  };
  lines: QuoteLinePrint[];
  totals: {
    taxable: string;
    taxes: QuoteTaxPrint[];
    rounding: string;
    total: string;
    totalInWords: string;
  };
  terms: string[];
  preparedBy: string;
  /**
   * Where the QR code leads, for the customer to open the quotation online; no code is printed
   * without one (a quote has no page for customers before the WhatsApp dispatch of Phase 2).
   */
  link?: string;
}

export interface PrintDocument {
  html: string;
  options: PdfOptions;
}

const MARGIN = { top: '15mm', right: '15mm', bottom: '18mm', left: '15mm' };

const css = `
.letterhead{display:flex;justify-content:space-between;gap:24px;padding-bottom:12px;border-bottom:2px solid var(--accent);}
.meta p,.party p{margin:0;}
.meta{text-align:right;}
.meta h2{font-size:16px;line-height:24px;color:var(--accent-text);}
.meta dl{margin:4px 0 0;display:grid;grid-template-columns:auto auto;gap:0 12px;justify-content:end;}
.meta dt{color:var(--text-muted);}
.meta dd{margin:0;font-weight:510;font-variant-numeric:tabular-nums;}
.party{margin:14px 0 12px;padding:10px 12px;background:var(--surface-2);border-radius:6px;display:flex;justify-content:space-between;gap:24px;}
.party .label{color:var(--text-muted);font-size:12px;line-height:16px;}
.party strong{font-weight:590;}
table.lines{width:100%;border-collapse:collapse;}
table.lines thead{display:table-header-group;}
table.lines th{font-weight:510;font-size:12px;line-height:16px;color:var(--text-muted);text-align:left;padding:6px 6px;border-bottom:1px solid var(--border-strong);background:var(--surface-2);}
table.lines th.num{text-align:right;}
table.lines td{padding:6px 6px;border-bottom:1px solid var(--border);vertical-align:top;}
table.lines tr{break-inside:avoid;}
table.lines .detail{color:var(--text-muted);font-size:12px;line-height:16px;}
.summary{display:flex;justify-content:space-between;gap:24px;margin-top:12px;break-inside:avoid;}
.words{flex:1;}
.words .label,.terms .label{color:var(--text-muted);font-size:12px;line-height:16px;}
table.totals{border-collapse:collapse;min-width:260px;}
table.totals td{padding:3px 6px;}
table.totals tr.total td{border-top:1px solid var(--border-strong);font-weight:590;font-size:14px;line-height:20px;padding-top:6px;}
.terms ol{margin:4px 0 0;padding-left:18px;}
.closing{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:14px;break-inside:avoid;}
.words .bank{margin-top:12px;}
.sign{margin-top:14px;}
.sign p{margin:0;}
.sign .for{font-weight:590;}
.qr{text-align:center;}
.qr svg{width:28mm;height:28mm;display:block;}
.qr p{margin:4px 0 0;font-size:12px;line-height:16px;color:var(--text-muted);max-width:32mm;}
`;

function footer(quote: QuotePrint): string {
  const t = printCopy();
  // Chromium fills these two spans in; the sentence stays whole in the catalogue.
  const page = t('quote.page', { page: '\u0001', total: '\u0002' });
  const pageHtml = html`${page}`.value
    .replace('\u0001', '<span class="pageNumber"></span>')
    .replace('\u0002', '<span class="totalPages"></span>');
  // The footer is drawn as its own small document: it gets the Latin font subset and the text
  // colour token as a literal, because the page's styles do not reach it.
  return html`<div
    style="width:100%;margin:0 15mm;display:flex;justify-content:space-between;font-family:Inter,system-ui,sans-serif;font-size:8pt;color:${lightColor('text-muted')};"
  >
    <style>
      ${trusted(interFontFaces().split('\n')[0] ?? '')}
    </style>
    <span>${quote.company.brandName} · ${quote.number}</span><span>${trusted(pageHtml)}</span>
  </div>`.value;
}

function lineRow(line: QuoteLinePrint, index: number): Html {
  return html`<tr>
    <td class="num">${index + 1}</td>
    <td>${line.description}${line.detail ? html`<div class="detail">${line.detail}</div>` : ''}</td>
    <td>${line.hsn}</td>
    <td class="num">${line.quantity} ${line.unit}</td>
    <td class="num">${formatAmount(line.rate)}</td>
    <td class="num">${line.gstRate}</td>
    <td class="num">${formatAmount(line.amount)}</td>
  </tr>`;
}

export async function renderQuote(
  quote: QuotePrint,
  options: TemplateOptions = {},
): Promise<PrintDocument> {
  const t = printCopy();
  const qr = quote.link === undefined ? undefined : await qrSvg(quote.link);
  const page = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"
        />
        <title>${t('quote.title')} ${quote.number}</title>
        <style>
          ${trusted(baseCss(options))}${trusted(companyCss)}${trusted(css)}
        </style>
      </head>
      <body>
        ${letterheadStrip(quote.company)}
        <header class="letterhead">
          ${companyBlock(quote.company, t)}
          <div class="meta">
            <h2>${t('quote.title')}</h2>
            <dl>
              <dt>${t('quote.number')}</dt>
              <dd>${quote.number}</dd>
              <dt>${t('quote.date')}</dt>
              <dd>${formatDate(quote.date)}</dd>
              <dt>${t('quote.validUntil')}</dt>
              <dd>${formatDate(quote.validUntil)}</dd>
            </dl>
          </div>
        </header>
        <section class="party">
          <div>
            <p class="label">${t('quote.for')}</p>
            <p><strong>${quote.customer.name}</strong></p>
            ${quote.customer.addressLines.map((l) => html`<p>${l}</p>`)}
            ${quote.customer.phone ? html`<p>${t('quote.phone')}: ${quote.customer.phone}</p>` : ''}
            ${quote.customer.gstin ? html`<p>${t('quote.gstin')}: ${quote.customer.gstin}</p>` : ''}
          </div>
          <div>
            <p class="label">${t('quote.placeOfSupply')}</p>
            <p>${quote.customer.placeOfSupply}</p>
          </div>
        </section>
        <table class="lines">
          <thead>
            <tr>
              <th class="num">${t('quote.columns.position')}</th>
              <th>${t('quote.columns.item')}</th>
              <th>${t('quote.columns.hsn')}</th>
              <th class="num">${t('quote.columns.quantity')}</th>
              <th class="num">${t('quote.columns.rate')}</th>
              <th class="num">${t('quote.columns.gst')}</th>
              <th class="num">${t('quote.columns.amount')}</th>
            </tr>
          </thead>
          <tbody>
            ${quote.lines.map(lineRow)}
          </tbody>
        </table>
        <section class="summary">
          <div class="words">
            <p class="label">${t('quote.inWords')}</p>
            <p>${quote.totals.totalInWords}</p>
            ${bankBlock(quote.company, t)}
          </div>
          <table class="totals">
            <tr>
              <td>${t('quote.taxable')}</td>
              <td class="num">${formatRupees(quote.totals.taxable)}</td>
            </tr>
            ${quote.totals.taxes.map(
              (x) =>
                html`<tr>
                  <td>
                    ${x.rate === undefined
                      ? t('quote.taxHead', { tax: x.tax })
                      : t('quote.tax', { tax: x.tax, rate: x.rate })}
                  </td>
                  <td class="num">${formatRupees(x.amount)}</td>
                </tr>`,
            )}
            <tr>
              <td>${t('quote.rounding')}</td>
              <td class="num">${formatRupees(quote.totals.rounding)}</td>
            </tr>
            <tr class="total">
              <td>${t('quote.total')}</td>
              <td class="num">${formatRupees(quote.totals.total)}</td>
            </tr>
          </table>
        </section>
        <section class="closing">
          <div>
            <div class="terms">
              <p class="label">${t('quote.terms')}</p>
              <ol>
                ${quote.terms.map((term) => html`<li>${term}</li>`)}
              </ol>
            </div>
            <div class="sign">
              <p class="for">${t('quote.signatory', { entity: quote.company.legalName })}</p>
              <p class="muted">${t('quote.preparedBy', { name: quote.preparedBy })}</p>
            </div>
          </div>
          ${qr === undefined
            ? ''
            : html`<div class="qr">
                ${trusted(qr)}
                <p>${t('quote.scan')}</p>
              </div>`}
        </section>
      </body>
    </html>`;
  return {
    html: page.value,
    options: {
      format: 'A4',
      margin: MARGIN,
      headerTemplate: '<span></span>',
      footerTemplate: options.fonts === 'viewer' ? '<span></span>' : footer(quote),
    },
  };
}
