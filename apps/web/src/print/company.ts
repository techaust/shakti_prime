// The selling company as every printed document shows it (BLUEPRINT §8.3, DESIGN.md §6 Print
// templates): its letterhead strip across the top, its logo beside its legal name, registered
// address and GSTIN, and its bank account for payment. The print loader fills this in for the
// one company a job names (`documents.ts`); a template never reads the database.
import type { PrintCopy } from './copy';
import { html, type Html } from './html';

/** An image printed inline (the page may load nothing): its type and its bytes in base64. */
export interface PrintImage {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

export interface CompanyBankPrint {
  bankName: string;
  accountNumber: string;
  ifsc: string;
  branch: string;
}

export interface CompanyPrint {
  legalName: string;
  brandName: string;
  /** The registered address, one line each, without empty lines. */
  addressLines: string[];
  gstin: string | null;
  logo: PrintImage | null;
  /** The strip printed the full width of the page above everything else. */
  letterhead: PrintImage | null;
  bank: CompanyBankPrint | null;
}

const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** An image as a data address; the type is checked, so nothing but an image is ever inlined. */
export function imageSource(image: PrintImage): string {
  if (!IMAGE_TYPES.has(image.contentType) || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)) {
    throw new RangeError('not a printable image');
  }
  return `data:${image.contentType};base64,${image.base64}`;
}

export const companyCss = `
.letterhead-strip{display:block;width:100%;max-height:40mm;object-fit:contain;object-position:left top;margin:0 0 10px;}
.company{display:flex;gap:12px;align-items:flex-start;}
.company .logo{display:block;max-width:32mm;max-height:18mm;object-fit:contain;}
.company h1{font-size:20px;line-height:28px;letter-spacing:-0.01em;}
.company p{margin:0;}
.bank{break-inside:avoid;}
.bank .label{color:var(--text-muted);font-size:12px;line-height:16px;}
.bank dl{margin:4px 0 0;display:grid;grid-template-columns:auto 1fr;gap:0 12px;}
.bank dt{color:var(--text-muted);}
.bank dd{margin:0;font-variant-numeric:tabular-nums;}
`;

/** The letterhead strip, when the company has one, for the top of the first page. */
export function letterheadStrip(company: CompanyPrint): Html | '' {
  return company.letterhead === null
    ? ''
    : html`<img class="letterhead-strip" src="${imageSource(company.letterhead)}" alt="" />`;
}

/** The logo, legal name, registered address and GSTIN; a missing detail is left out. */
export function companyBlock(company: CompanyPrint, t: PrintCopy): Html {
  return html`<div class="company">
    ${company.logo === null
      ? ''
      : html`<img
          class="logo"
          src="${imageSource(company.logo)}"
          alt="${t('company.logo', { name: company.brandName })}"
        />`}
    <div>
      <h1>${company.legalName}</h1>
      ${company.addressLines.map((line) => html`<p>${line}</p>`)}
      ${company.gstin === null ? '' : html`<p>${t('company.gstin')}: ${company.gstin}</p>`}
    </div>
  </div>`;
}

/** The bank account for payment, or nothing when none is recorded. */
export function bankBlock(company: CompanyPrint, t: PrintCopy): Html | '' {
  const bank = company.bank;
  if (bank === null) return '';
  return html`<section class="bank">
    <p class="label">${t('company.bank')}</p>
    <dl>
      <dt>${t('company.bankName')}</dt>
      <dd>${bank.bankName}</dd>
      <dt>${t('company.accountName')}</dt>
      <dd>${company.legalName}</dd>
      <dt>${t('company.accountNumber')}</dt>
      <dd>${bank.accountNumber}</dd>
      <dt>${t('company.ifsc')}</dt>
      <dd>${bank.ifsc}</dd>
      <dt>${t('company.branch')}</dt>
      <dd>${bank.branch}</dd>
    </dl>
  </section>`;
}
