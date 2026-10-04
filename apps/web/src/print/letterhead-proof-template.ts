// A company's proof page (docs/design/phase1.md §6.4): one A4 page with the letterhead, logo,
// address, GSTIN and bank account exactly as every document prints them, and a list that says
// which of them is recorded, so an Executive can check the print before any quote carries it.
// Rendered by the same worker and Chromium as every document, light theme, Inter embedded.
import { bankBlock, companyBlock, companyCss, letterheadStrip, type CompanyPrint } from './company';
import { printCopy, type PrintCopy } from './copy';
import { formatDate } from './format';
import { html, trusted, type Html } from './html';
import type { PrintDocument } from './quote-template';
import { baseCss, lightColor, interFontFaces, type TemplateOptions } from './styles';

export interface LetterheadProofPrint {
  company: CompanyPrint;
  /** The calendar date it was printed on, "YYYY-MM-DD" in IST. */
  printedOn: string;
}

const MARGIN = { top: '15mm', right: '15mm', bottom: '18mm', left: '15mm' };

const css = `
.head{padding-bottom:12px;border-bottom:2px solid var(--accent);}
h2{font-size:16px;line-height:24px;color:var(--accent-text);margin:16px 0 4px;}
.intro{margin:0 0 12px;}
table.checks{width:100%;border-collapse:collapse;margin-bottom:16px;}
table.checks th{font-weight:510;text-align:left;color:var(--text-muted);padding:6px;border-bottom:1px solid var(--border);width:34%;vertical-align:top;}
table.checks td{padding:6px;border-bottom:1px solid var(--border);vertical-align:top;}
.missing{color:var(--text-muted);}
`;

/** One line of the check list: what is printed, or that it is not recorded yet. */
function check(label: string, value: Html | string | null, t: PrintCopy): Html {
  return html`<tr>
    <th scope="row">${label}</th>
    <td>${value === null ? html`<span class="missing">${t('proof.missing')}</span>` : value}</td>
  </tr>`;
}

function footer(proof: LetterheadProofPrint): string {
  const t = printCopy();
  return html`<div
    style="width:100%;margin:0 15mm;display:flex;justify-content:space-between;font-family:Inter,system-ui,sans-serif;font-size:8pt;color:${lightColor('text-muted')};"
  >
    <style>
      ${trusted(interFontFaces().split('\n')[0] ?? '')}
    </style>
    <span>${proof.company.brandName}</span
    ><span>${t('proof.printedOn', { date: formatDate(proof.printedOn) })}</span>
  </div>`.value;
}

export function renderLetterheadProof(
  proof: LetterheadProofPrint,
  options: TemplateOptions = {},
): PrintDocument {
  const t = printCopy();
  const { company } = proof;
  const bank = company.bank;
  const page = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta
          http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"
        />
        <title>${t('proof.title', { name: company.legalName })}</title>
        <style>
          ${trusted(baseCss(options))}${trusted(companyCss)}${trusted(css)}
        </style>
      </head>
      <body>
        ${letterheadStrip(company)}
        <header class="head">${companyBlock(company, t)}</header>
        <h2>${t('proof.heading')}</h2>
        <p class="intro">${t('proof.intro')}</p>
        <table class="checks">
          <tbody>
            ${check(t('proof.letterhead'), company.letterhead ? t('proof.printedAbove') : null, t)}
            ${check(t('proof.logo'), company.logo ? t('proof.printedBeside') : null, t)}
            ${check(t('proof.legalName'), company.legalName, t)}
            ${check(t('proof.brandName'), company.brandName, t)}
            ${check(
              t('proof.address'),
              company.addressLines.length === 0
                ? null
                : html`${company.addressLines.map((line) => html`<div>${line}</div>`)}`,
              t,
            )}
            ${check(t('company.gstin'), company.gstin, t)}
            ${check(t('company.bankName'), bank?.bankName ?? null, t)}
            ${check(t('company.accountNumber'), bank?.accountNumber ?? null, t)}
            ${check(t('company.ifsc'), bank?.ifsc ?? null, t)}
            ${check(t('company.branch'), bank?.branch ?? null, t)}
          </tbody>
        </table>
        ${bankBlock(company, t)}
      </body>
    </html>`;
  return {
    html: page.value,
    options: {
      format: 'A4',
      margin: MARGIN,
      headerTemplate: '<span></span>',
      footerTemplate: options.fonts === 'viewer' ? '<span></span>' : footer(proof),
    },
  };
}
