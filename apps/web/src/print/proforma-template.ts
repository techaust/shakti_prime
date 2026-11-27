// A4 proforma invoice (docs/03-roadmap-appendix/phase5.md §6.1, question 3 (a)): the selling
// company's letterhead, logo, bank account and UPI ID from the print loader (`company.ts`), the
// order's lines with their HSN codes, the tax split, the total in words and the order's payments;
// light theme, 15 mm side margins, Inter embedded. Every amount arrives as the proforma holds it,
// copied from its order; this template only formats and places them.
import { bankBlock, companyBlock, companyCss, letterheadStrip, type CompanyPrint } from './company';
import { printCopy } from './copy';
import { formatAmount, formatDate, formatRupees } from './format';
import { html, trusted } from './html';
import {
  documentCss,
  lineRow,
  MARGIN,
  type PrintDocument,
  type QuoteLinePrint,
  type QuoteTaxPrint,
} from './quote-template';
import { baseCss, interFontFaces, lightColor, type TemplateOptions } from './styles';

export interface ProformaPaymentPrint {
  label: string;
  /** When it is due, in words. */
  due: string;
  amount: string;
}

export interface ProformaPrint {
  company: CompanyPrint;
  /** The company's UPI ID, printed for payment; null when none is recorded. */
  upiId: string | null;
  number: string;
  /** Calendar date, "YYYY-MM-DD". */
  date: string;
  orderNumber: string;
  cancelled: boolean;
  customer: {
    name: string;
    addressLines: string[];
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
  payments: ProformaPaymentPrint[];
  preparedBy: string;
}

const css = `
.cancelled{display:inline-block;margin-top:4px;padding:2px 8px;border:1px solid var(--danger);color:var(--danger);border-radius:4px;font-weight:590;}
.upi{margin-top:12px;break-inside:avoid;}
.upi .label{color:var(--text-muted);font-size:12px;line-height:16px;}
.upi p{margin:0;font-variant-numeric:tabular-nums;}
table.schedule{width:100%;border-collapse:collapse;margin-top:4px;}
table.schedule th{font-weight:510;font-size:12px;line-height:16px;color:var(--text-muted);text-align:left;padding:4px 6px;border-bottom:1px solid var(--border-strong);}
table.schedule th.num{text-align:right;}
table.schedule td{padding:4px 6px;border-bottom:1px solid var(--border);}
.payments{margin-top:14px;break-inside:avoid;}
.payments .label,.note .label{color:var(--text-muted);font-size:12px;line-height:16px;}
.note{margin-top:14px;break-inside:avoid;}
.note p{margin:0;}
`;

function footer(proforma: ProformaPrint): string {
  const t = printCopy();
  const page = t('quote.page', { page: '\u0001', total: '\u0002' });
  const pageHtml = html`${page}`.value
    .replace('\u0001', '<span class="pageNumber"></span>')
    .replace('\u0002', '<span class="totalPages"></span>');
  return html`<div
    style="width:100%;margin:0 15mm;display:flex;justify-content:space-between;font-family:Inter,system-ui,sans-serif;font-size:8pt;color:${lightColor('text-muted')};"
  >
    <style>
      ${trusted(interFontFaces().split('\n')[0] ?? '')}
    </style>
    <span>${proforma.company.brandName} · ${proforma.number}</span><span>${trusted(pageHtml)}</span>
  </div>`.value;
}

export function renderProforma(
  proforma: ProformaPrint,
  options: TemplateOptions = {},
): PrintDocument {
  const t = printCopy();
  const page = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"
        />
        <title>${t('proforma.title')} ${proforma.number}</title>
        <style>
          ${trusted(baseCss(options))}${trusted(companyCss)}${trusted(documentCss)}${trusted(css)}
        </style>
      </head>
      <body>
        ${letterheadStrip(proforma.company)}
        <header class="letterhead">
          ${companyBlock(proforma.company, t)}
          <div class="meta">
            <h2>${t('proforma.title')}</h2>
            ${proforma.cancelled ? html`<p class="cancelled">${t('proforma.cancelled')}</p>` : ''}
            <dl>
              <dt>${t('proforma.number')}</dt>
              <dd>${proforma.number}</dd>
              <dt>${t('proforma.date')}</dt>
              <dd>${formatDate(proforma.date)}</dd>
              <dt>${t('proforma.order')}</dt>
              <dd>${proforma.orderNumber}</dd>
            </dl>
          </div>
        </header>
        <section class="party">
          <div>
            <p class="label">${t('proforma.for')}</p>
            <p><strong>${proforma.customer.name}</strong></p>
            ${proforma.customer.addressLines.map((l) => html`<p>${l}</p>`)}
            ${
              proforma.customer.gstin
                ? html`<p>${t('quote.gstin')}: ${proforma.customer.gstin}</p>`
                : ''
            }
          </div>
          <div>
            <p class="label">${t('quote.placeOfSupply')}</p>
            <p>${proforma.customer.placeOfSupply}</p>
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
            ${proforma.lines.map(lineRow)}
          </tbody>
        </table>
        <section class="summary">
          <div class="words">
            <p class="label">${t('quote.inWords')}</p>
            <p>${proforma.totals.totalInWords}</p>
            ${bankBlock(proforma.company, t)}
            ${
              proforma.upiId === null
                ? ''
                : html`<div class="upi">
                    <p class="label">${t('proforma.payHeading')}</p>
                    <p>${t('proforma.upi')}: ${proforma.upiId}</p>
                  </div>`
            }
          </div>
          <table class="totals">
            <tr>
              <td>${t('quote.taxable')}</td>
              <td class="num">${formatRupees(proforma.totals.taxable)}</td>
            </tr>
            ${proforma.totals.taxes.map(
              (x) =>
                html`<tr>
                  <td>${t('quote.taxHead', { tax: x.tax })}</td>
                  <td class="num">${formatRupees(x.amount)}</td>
                </tr>`,
            )}
            <tr>
              <td>${t('quote.rounding')}</td>
              <td class="num">${formatRupees(proforma.totals.rounding)}</td>
            </tr>
            <tr class="total">
              <td>${t('quote.total')}</td>
              <td class="num">${formatRupees(proforma.totals.total)}</td>
            </tr>
          </table>
        </section>
        ${
          proforma.payments.length === 0
            ? ''
            : html`<section class="payments">
                <p class="label">${t('proforma.schedule')}</p>
                <table class="schedule">
                  <thead>
                    <tr>
                      <th>${t('proforma.scheduleColumns.payment')}</th>
                      <th>${t('proforma.scheduleColumns.due')}</th>
                      <th class="num">${t('proforma.scheduleColumns.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${proforma.payments.map(
                      (p) =>
                        html`<tr>
                          <td>${p.label}</td>
                          <td>${p.due}</td>
                          <td class="num">${formatAmount(p.amount)}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>
              </section>`
        }
        <section class="note">
          <p>${t('proforma.note')}</p>
          <p>${t('proforma.noteReference', { number: proforma.number })}</p>
          <div class="sign">
            <p class="for">${t('quote.signatory', { entity: proforma.company.legalName })}</p>
            <p class="muted">${t('quote.preparedBy', { name: proforma.preparedBy })}</p>
          </div>
        </section>
      </body>
    </html>`;
  return {
    html: page.value,
    options: {
      format: 'A4',
      margin: MARGIN,
      headerTemplate: '<span></span>',
      footerTemplate: options.fonts === 'viewer' ? '<span></span>' : footer(proforma),
    },
  };
}
