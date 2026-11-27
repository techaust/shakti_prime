// A4 purchase order (docs/03-roadmap-appendix/phase3.md §7.2): the buying company's letterhead
// strip, logo and block (the print loader's, as the quote's), the vendor, the hub goods go to, the
// lines and, for a reader of supplier rates only, the rates, amounts and the tax split; light
// theme, 15 mm side margins, Inter embedded. Every amount arrives computed by the domain (the
// order's rates and the tax engine); this only places them. An order prints from its approval on,
// dated the day it was approved; its cancelled version prints with "Cancelled" across it. Only the
// render worker prints it (ADR 0009), into the order's stored PDF.
import {
  PO_PDF_CANCELLED,
  purchaseOrderPdfVersion,
  type PurchaseOrderPdfVersion,
} from '@shakti/contracts';
import type { PurchaseOrderPrintData } from '@shakti/domain';
import { formatRate } from '../screens/procurement';
import { companyBlock, companyCss, letterheadStrip, type CompanyPrint } from './company';
import { printCopy } from './copy';
import { formatAmount, formatDate, formatRupees } from './format';
import { html, trusted } from './html';
import type { PrintDocument } from './quote-template';
import { baseCss, interFontFaces, lightColor } from './styles';

const MARGIN = { top: '15mm', right: '15mm', bottom: '18mm', left: '15mm' };

const css = `
.letterhead{display:flex;justify-content:space-between;gap:24px;padding-bottom:12px;border-bottom:2px solid var(--accent);}
.meta{text-align:right;}
.meta h2{font-size:16px;line-height:24px;color:var(--accent-text);}
.meta dl{margin:4px 0 0;display:grid;grid-template-columns:auto auto;gap:0 12px;justify-content:end;}
.meta dt{color:var(--text-muted);}
.meta dd{margin:0;font-weight:510;font-variant-numeric:tabular-nums;}
.party{margin:14px 0 12px;padding:10px 12px;background:var(--surface-2);border-radius:6px;display:flex;justify-content:space-between;gap:24px;}
.party p{margin:0;}
.party .label{color:var(--text-muted);font-size:12px;line-height:16px;}
.party strong{font-weight:590;}
table.lines{width:100%;border-collapse:collapse;}
table.lines thead{display:table-header-group;}
table.lines th{font-weight:510;font-size:12px;line-height:16px;color:var(--text-muted);text-align:left;padding:6px;border-bottom:1px solid var(--border-strong);background:var(--surface-2);}
table.lines th.num{text-align:right;}
table.lines td{padding:6px;border-bottom:1px solid var(--border);vertical-align:top;}
table.lines tr{break-inside:avoid;}
table.lines .detail{color:var(--text-muted);font-size:12px;line-height:16px;}
table.totals{border-collapse:collapse;min-width:260px;margin:12px 0 0 auto;break-inside:avoid;}
table.totals td{padding:3px 6px;}
table.totals tr.total td{border-top:1px solid var(--border-strong);font-weight:590;font-size:14px;line-height:20px;padding-top:6px;}
.withheld{margin-top:12px;color:var(--text-muted);}
.sign{margin-top:24px;break-inside:avoid;}
.sign p{margin:0;}
.sign .for{font-weight:590;}
.cancelled{position:fixed;top:45%;left:0;right:0;text-align:center;transform:rotate(-30deg);font-size:72px;line-height:80px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--danger);opacity:0.18;pointer-events:none;}
`;

/** A stored quantity as printed: `5.000` becomes `5`. */
const plainQty = (qty: string) => (qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty);

/** A rate of four decimals as the sheet shows it (`formatRate`), in a column of plain amounts. */
const rateText = (rate: string) => formatRate(rate).replace('₹', '');

/**
 * The PDF of a purchase order, with rates and totals only when the order carries them; the
 * company as the print loader read it (`loadCompanyLetterhead`). Only an order that prints
 * (`purchaseOrderPdfVersion`): a draft or an order never approved is refused, and so is the
 * cancelled version of an order not cancelled. `version` is the one the order prints now unless
 * named: version 1 is the order as approved, even once cancelled; version 2 is marked cancelled.
 */
export function renderPurchaseOrder(
  data: PurchaseOrderPrintData,
  company: CompanyPrint,
  printedOn: string,
  version?: PurchaseOrderPdfVersion,
): PrintDocument {
  const t = printCopy();
  const { order, vendor } = data;
  const approvedAt = order.approvedAt;
  const current = purchaseOrderPdfVersion(order.state, approvedAt);
  if (approvedAt === null || current === undefined) {
    throw new RangeError('a purchase order prints from its approval on');
  }
  if (version === PO_PDF_CANCELLED && current !== PO_PDF_CANCELLED) {
    throw new RangeError('only a cancelled order prints marked cancelled');
  }
  const cancelled = (version ?? current) === PO_PDF_CANCELLED;
  const rated = 'totals' in order ? order : undefined;
  const states = (code: string) => {
    const key = `states.${code}` as 'states.08';
    return t.has(key) ? t('purchaseOrder.state', { state: t(key), code }) : code;
  };
  const page = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"
        />
        <title>${t('purchaseOrder.title')} ${order.poNo}</title>
        <style>
          ${trusted(baseCss())}${trusted(companyCss)}${trusted(css)}
        </style>
      </head>
      <body>
        ${
          cancelled
            ? html`<div class="cancelled" role="note">${t('purchaseOrder.cancelled')}</div>`
            : ''
        }
        ${letterheadStrip(company)}
        <header class="letterhead">
          ${companyBlock(company, t)}
          <div class="meta">
            <h2>${t('purchaseOrder.title')}</h2>
            <dl>
              <dt>${t('purchaseOrder.number')}</dt>
              <dd>${order.poNo}</dd>
              <dt>${t('purchaseOrder.date')}</dt>
              <dd>${formatDate(approvedAt)}</dd>
              ${
                order.expectedAt === null
                  ? ''
                  : html`<dt>${t('purchaseOrder.expected')}</dt>
                      <dd>${formatDate(order.expectedAt)}</dd>`
              }
            </dl>
          </div>
        </header>
        <section class="party">
          <div>
            <p class="label">${t('purchaseOrder.to')}</p>
            <p><strong>${vendor.name}</strong></p>
            ${vendor.addressLines.map((line) => html`<p>${line}</p>`)}
            ${vendor.gstin === null ? '' : html`<p>${t('purchaseOrder.gstin')}: ${vendor.gstin}</p>`}
          </div>
          <div>
            <p class="label">${t('purchaseOrder.deliverTo')}</p>
            <p><strong>${order.hubName}</strong></p>
            <p>${t('purchaseOrder.placeOfSupply')}: ${states(order.placeOfSupplyStateCode)}</p>
          </div>
        </section>
        <table class="lines">
          <thead>
            <tr>
              <th class="num">${t('purchaseOrder.columns.position')}</th>
              <th>${t('purchaseOrder.columns.item')}</th>
              <th>${t('purchaseOrder.columns.hsn')}</th>
              <th class="num">${t('purchaseOrder.columns.quantity')}</th>
              <th class="num">${t('purchaseOrder.columns.gst')}</th>
              ${
                rated === undefined
                  ? ''
                  : html`<th class="num">${t('purchaseOrder.columns.rate')}</th>
                      <th class="num">${t('purchaseOrder.columns.amount')}</th>`
              }
            </tr>
          </thead>
          <tbody>
            ${order.lines.map((line, index) => {
              const rate = rated?.lines.find((l) => l.id === line.id);
              return html`<tr>
                <td class="num">${index + 1}</td>
                <td>
                  ${line.itemName}
                  <div class="detail">${line.sku}</div>
                </td>
                <td>${line.hsn}</td>
                <td class="num">
                  ${plainQty(line.qty)}
                  ${t(`quote.units.${line.purchaseUnit}` as 'quote.units.nos')}
                </td>
                <td class="num">
                  ${line.taxRatePct === null ? '' : t('quote.gstRate', { rate: Number(line.taxRatePct) })}
                </td>
                ${
                  rated === undefined
                    ? ''
                    : html`<td class="num">
                          ${rate?.unitRate == null ? '' : rateText(rate.unitRate)}
                        </td>
                        <td class="num">
                          ${rate?.amount == null ? '' : formatAmount(rate.amount)}
                        </td>`
                }
              </tr>`;
            })}
          </tbody>
        </table>
        ${
          rated === undefined
            ? html`<p class="withheld">${t('purchaseOrder.ratesWithheld')}</p>`
            : rated.totals === null
              ? html`<p class="withheld">${t('purchaseOrder.totalsWaiting')}</p>`
              : html`<table class="totals">
                  <tr>
                    <td>${t('quote.taxable')}</td>
                    <td class="num">${formatRupees(rated.totals.subtotal)}</td>
                  </tr>
                  ${
                    rated.totals.igst === '0.00'
                      ? html`<tr>
                            <td>${t('quote.taxHead', { tax: 'CGST' })}</td>
                            <td class="num">${formatRupees(rated.totals.cgst)}</td>
                          </tr>
                          <tr>
                            <td>${t('quote.taxHead', { tax: 'SGST' })}</td>
                            <td class="num">${formatRupees(rated.totals.sgst)}</td>
                          </tr>`
                      : html`<tr>
                          <td>${t('quote.taxHead', { tax: 'IGST' })}</td>
                          <td class="num">${formatRupees(rated.totals.igst)}</td>
                        </tr>`
                  }
                  <tr>
                    <td>${t('quote.rounding')}</td>
                    <td class="num">${formatRupees(rated.totals.roundOff)}</td>
                  </tr>
                  <tr class="total">
                    <td>${t('quote.total')}</td>
                    <td class="num">${formatRupees(rated.totals.grandTotal)}</td>
                  </tr>
                </table>`
        }
        <section class="sign">
          <p class="for">${t('quote.signatory', { entity: company.legalName })}</p>
        </section>
      </body>
    </html>`;
  const footer = html`<div
    style="width:100%;margin:0 15mm;display:flex;justify-content:space-between;font-family:Inter,system-ui,sans-serif;font-size:8pt;color:${lightColor('text-muted')};"
  >
    <style>
      ${trusted(interFontFaces().split('\n')[0] ?? '')}
    </style>
    <span
      >${company.brandName} · ${order.poNo} ·
      ${t('purchaseOrder.printed', { date: formatDate(printedOn) })}</span
    >
  </div>`.value;
  return {
    html: page.value,
    options: {
      format: 'A4',
      margin: MARGIN,
      headerTemplate: '<span></span>',
      footerTemplate: footer,
    },
  };
}
