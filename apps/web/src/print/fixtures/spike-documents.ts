// Spike and test data for the print templates (ROADMAP §2 week 6). Used by
// `scripts/spike/print.ts`, the print tests and the print preview on the `/design` page (the
// design review's view of the templates, titled as a preview); never on a document. The
// customer, addresses and numbers are made up; the amounts are worked out here in whole
// paise only so the rendered documents read consistently. In the product every amount comes
// from the Price Master snapshot and the tax engine in packages/domain.
import type { CompanyPrint, PrintImage } from '../company';
import type { LabelPrint } from '../label-template';
import type { QuoteLinePrint, QuotePrint } from '../quote-template';

interface Product {
  description: string;
  detail: string;
  hsn: string;
  unit: string;
  /** Rate in paise, before tax. */
  rate: number;
  /** GST in basis points (1800 = 18%). */
  gst: number;
}

const PRODUCTS: Product[] = [
  {
    description: 'Solar pump set, 7.5 HP submersible',
    detail: 'AC motor, 100 m head, stainless steel',
    hsn: '8413',
    unit: 'Set',
    rate: 18_750_000,
    gst: 1200,
  },
  {
    description: 'Solar panels, 540 Wp mono PERC',
    detail: 'Module efficiency 21.1%',
    hsn: '8541',
    unit: 'Nos',
    rate: 1_425_000,
    gst: 1200,
  },
  {
    description: 'Pump controller with remote monitoring',
    detail: 'Matched to 7.5 HP, dry-run protection',
    hsn: '8504',
    unit: 'Nos',
    rate: 3_850_000,
    gst: 1800,
  },
  {
    description: 'Module mounting structure',
    detail: 'Hot-dip galvanised, for 14 panels',
    hsn: '7308',
    unit: 'Set',
    rate: 2_640_000,
    gst: 1800,
  },
  {
    description: 'DC cable, 4 sq mm',
    detail: 'Copper, UV resistant',
    hsn: '8544',
    unit: 'm',
    rate: 9_500,
    gst: 1800,
  },
  {
    description: 'Earthing kit',
    detail: 'Chemical earthing with lightning arrester',
    hsn: '8535',
    unit: 'Set',
    rate: 480_000,
    gst: 1800,
  },
  {
    description: 'Installation and commissioning',
    detail: 'At site, with foundation work',
    hsn: '9954',
    unit: 'Job',
    rate: 1_500_000,
    gst: 1800,
  },
];

const QUANTITY = [1, 14, 1, 1, 60, 1, 1];

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const tens = TENS[Math.floor(n / 10)] ?? '';
  const ones = ONES[n % 10] ?? '';
  return ones ? `${tens} ${ones}` : tens;
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds] ?? ''} Hundred` : '', rest ? belowHundred(rest) : '']
    .filter(Boolean)
    .join(' ');
}

/** Whole rupees in words, Indian style (lakh, crore). Spike data only. */
function rupeesInWords(rupees: number): string {
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return `Rupees ${parts.join(' ')} only`;
}

const money = (paise: number) =>
  `${Math.trunc(paise / 100)}.${String(Math.abs(paise % 100)).padStart(2, '0')}`;
const percent = (bp: number) => `${bp / 100}%`;

/**
 * The selling company of the spike documents, with a made-up address, GSTIN and bank account, and
 * the logo and letterhead when the caller has them (`spikeImages`).
 */
export function spikeCompany(images: { logo?: PrintImage; letterhead?: PrintImage } = {}): CompanyPrint {
  return {
    legalName: 'Agro Solar Hub',
    brandName: 'Agro Solar Hub',
    addressLines: ['Plot 14, Sitapura Industrial Area', 'Jaipur, Rajasthan 302022'],
    gstin: '08AAKFA4821M1Z3',
    logo: images.logo ?? null,
    letterhead: images.letterhead ?? null,
    bank: {
      bankName: 'State Bank of India',
      accountNumber: '32145698710',
      ifsc: 'SBIN0011528',
      branch: 'Sitapura, Jaipur',
    },
  };
}

/** A quotation with `sites` copies of the seven-line solar pump kit. */
export function spikeQuote(sites = 1): QuotePrint {
  const lines: QuoteLinePrint[] = [];
  const taxByRate = new Map<number, number>();
  let taxable = 0;
  for (let s = 0; s < sites; s++) {
    PRODUCTS.forEach((p, i) => {
      const quantity = QUANTITY[i] ?? 1;
      const amount = p.rate * quantity;
      taxable += amount;
      taxByRate.set(p.gst, (taxByRate.get(p.gst) ?? 0) + Math.round((amount * p.gst) / 10_000));
      lines.push({
        description: p.description,
        detail: sites > 1 ? `${p.detail}. Site ${s + 1}` : p.detail,
        hsn: p.hsn,
        quantity: String(quantity),
        unit: p.unit,
        rate: money(p.rate),
        gstRate: percent(p.gst),
        amount: money(amount),
      });
    });
  }
  const taxes: QuotePrint['totals']['taxes'] = [];
  let taxTotal = 0;
  for (const [rate, tax] of [...taxByRate].sort((a, b) => a[0] - b[0])) {
    const half = Math.round(tax / 2);
    taxes.push({ tax: 'CGST', rate: percent(rate / 2), amount: money(half) });
    taxes.push({ tax: 'SGST', rate: percent(rate / 2), amount: money(tax - half) });
    taxTotal += tax;
  }
  const exact = taxable + taxTotal;
  const total = Math.round(exact / 100) * 100;
  return {
    company: spikeCompany(),
    number: sites > 1 ? 'ASH/QT/2026-27/000418' : 'ASH/QT/2026-27/000412',
    date: '2026-09-27',
    validUntil: '2026-10-27',
    customer: {
      name: 'Ramesh Kumar Meena',
      addressLines: ['Village Rampura, Tehsil Chomu', 'District Jaipur, Rajasthan 303702'],
      phone: '98290 41736',
      placeOfSupply: 'Rajasthan (08)',
    },
    lines,
    totals: {
      taxable: money(taxable),
      taxes,
      rounding: money(total - exact),
      total: money(total),
      totalInWords: rupeesInWords(total / 100),
    },
    terms: [
      'Prices are valid until the date above.',
      '50% advance with the order, the balance before dispatch.',
      'Delivery within 15 days of the advance.',
      'Five-year warranty on the pump and controller; 25-year performance warranty on the panels.',
    ],
    preparedBy: 'Priya Sharma',
    link: `https://shaktiprime.com/q/${sites > 1 ? 'ASH2627000418' : 'ASH2627000412'}`,
  };
}

/** `count` labels for pump controllers with consecutive serial numbers. */
export function spikeLabels(count: number): LabelPrint[] {
  return Array.from({ length: count }, (_, i) => {
    const serial = `ASH26C${String(i + 1).padStart(6, '0')}`;
    return {
      entityName: 'Agro Solar Hub',
      itemName: 'Pump controller with remote monitoring, 7.5 HP',
      itemCode: 'ASH-PC-075',
      serial,
      qrPayload: `https://shaktiprime.com/s/${serial}`,
    };
  });
}
