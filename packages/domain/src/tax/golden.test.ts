import {
  newId,
  type CompositeRuleRow,
  type DocumentTotals,
  type Segment,
  type TaxRateRow,
} from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { resolveCompositeRule } from './composite';
import { computeDocument } from './compute-document';
import { computeLine } from './compute-line';
import { placeOfSupply } from './place-of-supply';
import { resolveRate } from './resolve-rate';

/*
 * GOLDEN SET, AWAITING CA CONFIRMATION (docs/design/backend-weeks-3-5.md §12 q1, ADR 0007).
 *
 * Worked examples computed by hand with the method of ADR 0007: half-up to the paisa per line and
 * per tax head, CGST and SGST each from half the rate, the document rounded to the rupee with
 * `round_off`, place of supply site → GSTIN → entity. The CA confirms or corrects each expected
 * figure at the discovery workshop; this file then becomes the signed-off fixture set. The rates
 * are illustrative, not the notified rates; only the arithmetic is under review.
 */

const ON = new Date('2026-06-15T11:00:00+05:30');
const MH = '27';

const rates: TaxRateRow[] = [
  {
    id: newId(),
    hsn: '8413',
    itemId: null,
    ratePct: '5.00',
    effectiveFrom: '2025-04-01',
    effectiveTo: null,
  },
  {
    id: newId(),
    hsn: '8504',
    itemId: null,
    ratePct: '18.00',
    effectiveFrom: '2025-04-01',
    effectiveTo: null,
  },
];

const rules: CompositeRuleRow[] = [
  {
    id: newId(),
    segment: 'residential_rooftop',
    goodsSharePct: '70.00',
    servicesSharePct: '30.00',
    goodsRatePct: '12.00',
    servicesRatePct: '18.00',
    effectiveFrom: '2025-04-01',
    effectiveTo: null,
  },
];

interface GoldenLine {
  hsn: string;
  qty: string;
  unitPrice: string;
  worksContract?: boolean;
}

interface GoldenCase {
  name: string;
  segment: Segment;
  siteStateCode: string | null;
  accountGstin: string | null;
  lines: GoldenLine[];
  expectedLines: {
    taxableValue: string;
    cgst: string;
    sgst: string;
    igst: string;
    lineTotal: string;
  }[];
  expected: DocumentTotals;
}

const GOLDEN: GoldenCase[] = [
  {
    name: 'G1 farmer pump sold within Maharashtra, 5%',
    segment: 'farmer_pumps',
    siteStateCode: MH,
    accountGstin: null,
    lines: [{ hsn: '8413', qty: '1', unitPrice: '45000.00' }],
    expectedLines: [
      {
        taxableValue: '45000.00',
        cgst: '1125.00',
        sgst: '1125.00',
        igst: '0.00',
        lineTotal: '47250.00',
      },
    ],
    expected: {
      subtotal: '45000.00',
      cgst: '1125.00',
      sgst: '1125.00',
      igst: '0.00',
      taxTotal: '2250.00',
      roundOff: '0.00',
      grandTotal: '47250.00',
    },
  },
  {
    name: 'G2 dealer in Gujarat by GSTIN, no site, 18% IGST with a rupee round-up',
    segment: 'dealer_wholesale',
    siteStateCode: null,
    accountGstin: '24ABCDE1234F1Z5',
    lines: [{ hsn: '8504', qty: '3', unitPrice: '12345.67' }],
    expectedLines: [
      {
        taxableValue: '37037.01',
        cgst: '0.00',
        sgst: '0.00',
        igst: '6666.66',
        lineTotal: '43703.67',
      },
    ],
    expected: {
      subtotal: '37037.01',
      cgst: '0.00',
      sgst: '0.00',
      igst: '6666.66',
      taxTotal: '6666.66',
      roundOff: '0.33',
      grandTotal: '43704.00',
    },
  },
  {
    name: 'G3 rooftop works contract within Maharashtra, 70:30 at 12% and 18%',
    segment: 'residential_rooftop',
    siteStateCode: MH,
    accountGstin: null,
    lines: [{ hsn: '8541', qty: '1', unitPrice: '180000.00', worksContract: true }],
    expectedLines: [
      {
        taxableValue: '180000.00',
        cgst: '12420.00',
        sgst: '12420.00',
        igst: '0.00',
        lineTotal: '204840.00',
      },
    ],
    expected: {
      subtotal: '180000.00',
      cgst: '12420.00',
      sgst: '12420.00',
      igst: '0.00',
      taxTotal: '24840.00',
      roundOff: '0.00',
      grandTotal: '204840.00',
    },
  },
  {
    name: 'G4 two lines within Maharashtra with half-paisa rounding and a rupee round-down',
    segment: 'commercial_epc',
    siteStateCode: MH,
    accountGstin: '24ABCDE1234F1Z5',
    lines: [
      { hsn: '8504', qty: '7', unitPrice: '13.33' },
      { hsn: '8413', qty: '1', unitPrice: '0.20' },
    ],
    expectedLines: [
      { taxableValue: '93.31', cgst: '8.40', sgst: '8.40', igst: '0.00', lineTotal: '110.11' },
      { taxableValue: '0.20', cgst: '0.01', sgst: '0.01', igst: '0.00', lineTotal: '0.22' },
    ],
    expected: {
      subtotal: '93.51',
      cgst: '8.41',
      sgst: '8.41',
      igst: '0.00',
      taxTotal: '16.82',
      roundOff: '-0.33',
      grandTotal: '110.00',
    },
  },
];

describe('golden set, awaiting CA confirmation (design §12 q1)', () => {
  it.each(GOLDEN)('$name', (golden) => {
    const supply = placeOfSupply({
      siteStateCode: golden.siteStateCode,
      accountGstin: golden.accountGstin,
      entityStateCode: MH,
    });
    const lines = golden.lines.map((line) => {
      const composite = resolveCompositeRule(rules, {
        segment: golden.segment,
        worksContract: line.worksContract ?? false,
        on: ON,
      });
      return computeLine({
        qty: line.qty,
        unitPrice: line.unitPrice,
        rate: composite ? null : resolveRate(rates, { hsn: line.hsn, itemId: null, on: ON }),
        composite,
        supply,
      });
    });
    expect(lines).toMatchObject(golden.expectedLines);
    expect(computeDocument(lines)).toEqual(golden.expected);
  });
});
