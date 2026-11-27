// A stock count's sheet for the record (docs/03-roadmap-appendix/phase3.md §7.3): the company, the
// hub, what was counted, and every line with what the records held when it was counted, what was
// counted and the difference, the value only for a reader of costs, and lines to sign. A4, light
// theme. It prints the Inventory Manager's review as it stands; no worker reads a count, so the
// expected quantities reach no one the review would not show them to.
import { printCopy } from './copy';
import { formatAmount, formatDate, formatRupees } from './format';
import { html, trusted } from './html';
import type { PrintDocument } from './quote-template';
import { baseCss, type TemplateOptions } from './styles';

export interface StockCountLinePrint {
  bin: string;
  item: string;
  sku: string;
  serial: string | null;
  /** Ledger quantities, `12.500`; the moved and expected ones may be below zero. */
  atStart: string;
  moved: string;
  expected: string;
  counted: string | null;
  variance: string | null;
  /** The variance's value, only for a reader of costs. */
  value: string | null;
}

export interface StockCountPrint {
  company: string;
  hub: string;
  scope: string;
  state: string;
  /** ISO instants. */
  startedAt: string;
  startedBy: string;
  postedAt: string | null;
  note: string | null;
  lines: StockCountLinePrint[];
  showsValues: boolean;
  netValue: string | null;
  /** The calendar date it was printed on, "YYYY-MM-DD" in IST. */
  printedOn: string;
}

const MARGIN = { top: '12mm', right: '12mm', bottom: '15mm', left: '12mm' };

const css = `
.head{display:flex;justify-content:space-between;gap:24px;padding-bottom:8px;border-bottom:2px solid var(--accent);}
.head h1{font-size:18px;line-height:24px;}
dl.facts{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:12px 0;}
dl.facts dt{color:var(--text-muted);}
dl.facts dd{margin:0;}
table.lines{width:100%;border-collapse:collapse;margin-top:8px;}
table.lines th{font-weight:510;text-align:left;color:var(--text-muted);padding:4px;border-bottom:1px solid var(--border-strong);}
table.lines td{padding:4px;border-bottom:1px solid var(--border);vertical-align:top;}
table.lines tr{break-inside:avoid;}
.diff{font-weight:590;}
.total{margin-top:8px;text-align:right;font-weight:590;}
.signs{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:40px;}
.signs div{border-top:1px solid var(--border-strong);padding-top:4px;color:var(--text-muted);}
`;

/** A ledger quantity as printed: lakh grouping, no trailing zeros, its sign kept. */
function qty(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const kept = fraction.replace(/0+$/, '');
  const grouped = formatAmount(`${whole}.00`).replace(/\.00$/, '');
  const text = kept === '' ? grouped : `${grouped}.${kept}`;
  return negative && text !== '0' ? `-${text}` : text;
}

/** A difference with its sign: `+2`, `-1.5`, `0`. */
function signed(value: string): string {
  const text = qty(value);
  return Number(value) > 0 ? `+${text}` : text;
}

/** IST date and time of an instant, `27-11-2026 14:30`. */
function when(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 330 * 60_000);
  const time = shifted.toISOString().slice(11, 16);
  return `${formatDate(shifted.toISOString().slice(0, 10))} ${time}`;
}

export function renderStockCountSheet(
  sheet: StockCountPrint,
  options: TemplateOptions = {},
): PrintDocument {
  const t = printCopy();
  const fact = (label: string, value: string) =>
    html`<dt>${label}</dt>
      <dd>${value}</dd>`;
  const page = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"
        />
        <title>${t('stockCount.fileTitle', { hub: sheet.hub })}</title>
        <style>
          ${trusted(baseCss(options))}${trusted(css)}
        </style>
      </head>
      <body>
        <header class="head">
          <h1>${t('stockCount.title')}</h1>
          <span class="muted"
            >${t('stockCount.printedOn', { date: formatDate(sheet.printedOn) })}</span
          >
        </header>
        <dl class="facts">
          ${fact(t('stockCount.company'), sheet.company)} ${fact(t('stockCount.hub'), sheet.hub)}
          ${fact(t('stockCount.scope'), sheet.scope)} ${fact(t('stockCount.state'), sheet.state)}
          ${fact(t('stockCount.started'), when(sheet.startedAt))}
          ${fact(t('stockCount.startedBy'), sheet.startedBy)}
          ${sheet.postedAt === null ? '' : fact(t('stockCount.posted'), when(sheet.postedAt))}
          ${sheet.note === null ? '' : fact(t('stockCount.note'), sheet.note)}
        </dl>
        <table class="lines">
          <thead>
            <tr>
              <th>${t('stockCount.columns.bin')}</th>
              <th>${t('stockCount.columns.item')}</th>
              <th>${t('stockCount.columns.serial')}</th>
              <th class="num">${t('stockCount.columns.atStart')}</th>
              <th class="num">${t('stockCount.columns.moved')}</th>
              <th class="num">${t('stockCount.columns.expected')}</th>
              <th class="num">${t('stockCount.columns.counted')}</th>
              <th class="num">${t('stockCount.columns.variance')}</th>
              ${sheet.showsValues ? html`<th class="num">${t('stockCount.columns.value')}</th>` : ''}
            </tr>
          </thead>
          <tbody>
            ${sheet.lines.map(
              (line) =>
                html`<tr>
                  <td>${line.bin}</td>
                  <td>
                    ${line.item}
                    <div class="muted">${line.sku}</div>
                  </td>
                  <td>${line.serial ?? ''}</td>
                  <td class="num">${qty(line.atStart)}</td>
                  <td class="num">${signed(line.moved)}</td>
                  <td class="num">${qty(line.expected)}</td>
                  <td class="num">
                    ${line.counted === null ? t('stockCount.notCounted') : qty(line.counted)}
                  </td>
                  <td
                    class="num ${line.variance !== null && Number(line.variance) !== 0 ? 'diff' : ''}"
                  >
                    ${line.variance === null ? '' : signed(line.variance)}
                  </td>
                  ${
                    sheet.showsValues
                      ? html`<td class="num">
                          ${line.value === null ? '' : formatRupees(line.value)}
                        </td>`
                      : ''
                  }
                </tr>`,
            )}
          </tbody>
        </table>
        ${
          sheet.showsValues && sheet.netValue !== null
            ? html`<p class="total">
                ${t('stockCount.netValue')}: ${formatRupees(sheet.netValue)}
              </p>`
            : ''
        }
        <div class="signs">
          <div>${t('stockCount.signCounted')}</div>
          <div>${t('stockCount.signReviewed')}</div>
          <div>${t('stockCount.signApproved')}</div>
        </div>
      </body>
    </html>`;
  return {
    html: page.value,
    options: {
      format: 'A4',
      margin: MARGIN,
      headerTemplate: '<span></span>',
      footerTemplate: '<span></span>',
    },
  };
}
