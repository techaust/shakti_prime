import type { CompositeRuleRow, PlaceOfSupply, TaxRateRow } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { fromPaise, toPaise } from '../money/paise';
import { forAllSeeded, type SeededGenerator } from '../seeded-generator';
import { priceQuote, type PricedSource, type QuotePricingLine } from './quote-pricing';

// Every rate, split and price here is a synthetic test value made for these cases, never a client
// figure: the client's GST rates and price lists are workshop inputs (PRICE-4, PRICE-2).
const ON = new Date('2026-10-05T10:00:00+05:30');
const INTRA: PlaceOfSupply = { stateCode: '08', kind: 'intra', source: 'site' };
const INTER: PlaceOfSupply = { stateCode: '24', kind: 'inter', source: 'site' };
const RATE_A = '01990000-0000-7000-8000-00000000c001';
const RATE_B = '01990000-0000-7000-8000-00000000c002';
const RULE = '01990000-0000-7000-8000-00000000c003';
const ITEM_A = '01990000-0000-7000-8000-00000000c004';
const ITEM_B = '01990000-0000-7000-8000-00000000c005';
const KIT = '01990000-0000-7000-8000-00000000c006';

const rates: TaxRateRow[] = [
  {
    id: RATE_A,
    hsn: '8413',
    itemId: null,
    ratePct: '12.00',
    effectiveFrom: '2026-04-01',
    effectiveTo: null,
  },
  {
    id: RATE_B,
    hsn: null,
    itemId: ITEM_B,
    ratePct: '18.00',
    effectiveFrom: '2026-04-01',
    effectiveTo: null,
  },
];
const rule: CompositeRuleRow = {
  id: RULE,
  segment: 'residential_rooftop',
  goodsSharePct: '70.00',
  servicesSharePct: '30.00',
  goodsRatePct: '12.00',
  servicesRatePct: '18.00',
  effectiveFrom: '2026-04-01',
  effectiveTo: null,
};

const item = (id: string, hsn: string, price: string): PricedSource => ({
  kind: 'item',
  id,
  sku: `SKU-${id.slice(-4)}`,
  name: `Item ${id.slice(-4)}`,
  unit: 'nos',
  hsn,
  price,
});
const kit: PricedSource = {
  kind: 'kit',
  id: KIT,
  sku: 'KIT-1',
  name: 'Kit 1',
  unit: 'set',
  hsn: null,
  price: '150000.00',
};

describe('priceQuote (design §7.3, ADR 0007)', () => {
  it('prices each line from its list price and taxes it intra-state as CGST and SGST', () => {
    const quote = priceQuote({
      segment: 'farmer_pumps',
      on: ON,
      supply: INTRA,
      rates,
      compositeRules: [rule],
      lines: [
        { source: item(ITEM_A, '8413', '10000.00'), qty: '2', worksContract: false },
        { source: item(ITEM_B, '8541', '333.33'), qty: '3', worksContract: false },
      ],
    });
    expect(quote.lines.map((l) => [l.taxableValue, l.cgst, l.sgst, l.igst, l.lineTotal])).toEqual([
      ['20000.00', '1200.00', '1200.00', '0.00', '22400.00'],
      // 999.99 at 18%: 179.9982 split into two halves of 89.9991, each rounded to 90.00.
      ['999.99', '90.00', '90.00', '0.00', '1179.99'],
    ]);
    expect(quote.lines[1]).toMatchObject({ taxRateId: RATE_B, taxRatePct: '18.00' });
    expect(quote.totals).toEqual({
      subtotal: '20999.99',
      cgst: '1290.00',
      sgst: '1290.00',
      igst: '0.00',
      taxTotal: '2580.00',
      roundOff: '0.01',
      grandTotal: '23580.00',
    });
  });

  it('taxes an inter-state line as IGST at the full rate', () => {
    const quote = priceQuote({
      segment: 'farmer_pumps',
      on: ON,
      supply: INTER,
      rates,
      compositeRules: [],
      lines: [{ source: item(ITEM_B, '8541', '333.33'), qty: '3', worksContract: false }],
    });
    expect(quote.lines[0]).toMatchObject({ cgst: '0.00', sgst: '0.00', igst: '180.00' });
    expect(quote.totals).toMatchObject({ igst: '180.00', roundOff: '0.01', grandTotal: '1180.00' });
  });

  it('splits a works contract in a composite segment by the rule, a kit included', () => {
    const quote = priceQuote({
      segment: 'residential_rooftop',
      on: ON,
      supply: INTRA,
      rates,
      compositeRules: [rule],
      lines: [{ source: kit, qty: '1', worksContract: true }],
    });
    expect(quote.lines[0]).toMatchObject({
      kitId: KIT,
      itemId: null,
      hsn: null,
      taxRateId: null,
      taxRatePct: null,
      compositeRuleId: RULE,
      goodsRatePct: '12.00',
      servicesRatePct: '18.00',
      goodsTaxable: '105000.00',
      servicesTaxable: '45000.00',
      // 105,000 at 12% and 45,000 at 18%: 12,600 + 8,100 = 20,700, halved.
      cgst: '10350.00',
      sgst: '10350.00',
    });
  });

  it('taxes a works contract outside the composite segments at its own rate', () => {
    const quote = priceQuote({
      segment: 'farmer_pumps',
      on: ON,
      supply: INTRA,
      rates,
      compositeRules: [rule],
      lines: [{ source: item(ITEM_A, '8413', '100.00'), qty: '1', worksContract: true }],
    });
    expect(quote.lines[0]).toMatchObject({ taxRateId: RATE_A, compositeRuleId: null });
  });

  it('refuses a kit that is not a composite works contract, having no rate of its own', () => {
    expect(() =>
      priceQuote({
        segment: 'farmer_pumps',
        on: ON,
        supply: INTRA,
        rates,
        compositeRules: [rule],
        lines: [{ source: kit, qty: '1', worksContract: false }],
      }),
    ).toThrow(
      expect.objectContaining({ details: { reason: 'quote_kit_tax_missing', sku: 'KIT-1' } }),
    );
  });

  it('refuses a line with no rate on the quote date', () => {
    expect(() =>
      priceQuote({
        segment: 'farmer_pumps',
        on: new Date('2026-03-31T10:00:00+05:30'),
        supply: INTRA,
        rates,
        compositeRules: [],
        lines: [{ source: item(ITEM_A, '8413', '100.00'), qty: '1', worksContract: false }],
      }),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'tax_rate_missing' }) as unknown,
      }),
    );
  });

  it('refuses a works contract in a composite segment with no rule on the quote date', () => {
    expect(() =>
      priceQuote({
        segment: 'residential_rooftop',
        on: ON,
        supply: INTRA,
        rates,
        compositeRules: [],
        lines: [{ source: kit, qty: '1', worksContract: true }],
      }),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'composite_rule_missing' }) as unknown,
      }),
    );
  });
});

describe('quote totals, property tests', () => {
  const RUNS = 400;
  const RATES = ['0.00', '0.25', '3.00', '5.00', '12.00', '18.00', '28.00'];

  function randomLines(random: SeededGenerator) {
    const count = random.int(1, 8);
    const lines: QuotePricingLine[] = [];
    const rows: TaxRateRow[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = `01990000-0000-7000-8000-0000000d${String(i).padStart(4, '0')}`;
      const pricePaise = random.int(1, 50_000_000);
      const qtyMilli = random.int(1, 50_000);
      rows.push({
        id: `01990000-0000-7000-8000-0000000e${String(i).padStart(4, '0')}`,
        hsn: null,
        itemId: id,
        ratePct: random.pick(RATES),
        effectiveFrom: '2026-04-01',
        effectiveTo: null,
      });
      lines.push({
        source: item(id, '8413', fromPaise(BigInt(pricePaise))),
        qty: (qtyMilli / 1000).toFixed(3).replace(/\.?0+$/, ''),
        worksContract: random.chance(),
      });
    }
    return { lines, rows };
  }

  it('totals are the sums of the lines, rounded once to the rupee', () => {
    forAllSeeded(7, RUNS, (random) => {
      const { lines, rows } = randomLines(random);
      const supply = random.chance() ? INTRA : INTER;
      const segment = random.pick(['farmer_pumps', 'residential_rooftop'] as const);
      const quote = priceQuote({
        segment,
        on: ON,
        supply,
        rates: rows,
        compositeRules: [rule],
        lines,
      });
      const sum = (key: 'taxableValue' | 'cgst' | 'sgst' | 'igst' | 'lineTotal') =>
        quote.lines.reduce((total, l) => total + toPaise(l[key]), 0n);
      const { totals } = quote;
      expect(toPaise(totals.subtotal)).toBe(sum('taxableValue'));
      expect(toPaise(totals.cgst)).toBe(sum('cgst'));
      expect(toPaise(totals.sgst)).toBe(sum('sgst'));
      expect(toPaise(totals.igst)).toBe(sum('igst'));
      expect(toPaise(totals.taxTotal)).toBe(sum('cgst') + sum('sgst') + sum('igst'));
      const exact = sum('lineTotal');
      const grand = toPaise(totals.grandTotal);
      // A whole rupee, within half a rupee of the exact total, the difference kept as round-off.
      expect(grand % 100n).toBe(0n);
      expect(grand - exact).toBe(toPaise(totals.roundOff));
      expect(toPaise(totals.roundOff) >= -49n && toPaise(totals.roundOff) <= 50n).toBe(true);
    });
  });

  it('each line is its quantity times its price, rounded half-up to the paisa', () => {
    forAllSeeded(11, RUNS, (random) => {
      const { lines, rows } = randomLines(random);
      const quote = priceQuote({
        segment: 'farmer_pumps',
        on: ON,
        supply: INTRA,
        rates: rows,
        compositeRules: [],
        lines,
      });
      quote.lines.forEach((l, i) => {
        const line = lines[i];
        if (line === undefined) throw new Error('line missing');
        const [whole = '0', fraction = ''] = line.qty.split('.');
        const qtyMilli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
        const exact = toPaise(line.source.price) * qtyMilli;
        expect(toPaise(l.taxableValue)).toBe((exact * 2n + 1000n) / 2000n);
        expect(l.unitPrice).toBe(line.source.price);
      });
    });
  });

  it('intra-state lines carry equal CGST and SGST and no IGST; inter-state lines only IGST', () => {
    forAllSeeded(13, RUNS, (random) => {
      const { lines, rows } = randomLines(random);
      const intra = priceQuote({
        segment: 'farmer_pumps',
        on: ON,
        supply: INTRA,
        rates: rows,
        compositeRules: [],
        lines,
      });
      const inter = priceQuote({
        segment: 'farmer_pumps',
        on: ON,
        supply: INTER,
        rates: rows,
        compositeRules: [],
        lines,
      });
      intra.lines.forEach((l, i) => {
        const other = inter.lines[i];
        if (other === undefined) throw new Error('line missing');
        expect(l.cgst).toBe(l.sgst);
        expect(l.igst).toBe('0.00');
        expect(other.cgst).toBe('0.00');
        expect(other.sgst).toBe('0.00');
        // Each half rounds on its own, so the two halves differ from the whole by a paisa at most.
        const halves = toPaise(l.cgst) + toPaise(l.sgst);
        const whole = toPaise(other.igst);
        expect(halves - whole >= -1n && halves - whole <= 1n).toBe(true);
        expect(other.taxableValue).toBe(l.taxableValue);
      });
    });
  });

  it('a composite line splits its taxable value into goods and services that add up to it', () => {
    forAllSeeded(17, RUNS, (random) => {
      const { lines, rows } = randomLines(random);
      const quote = priceQuote({
        segment: 'residential_rooftop',
        on: ON,
        supply: random.chance() ? INTRA : INTER,
        rates: rows,
        compositeRules: [rule],
        lines,
      });
      quote.lines.forEach((l, i) => {
        if (lines[i]?.worksContract === true) {
          expect(l.compositeRuleId).toBe(RULE);
          expect(toPaise(l.goodsTaxable ?? '0.00') + toPaise(l.servicesTaxable ?? '0.00')).toBe(
            toPaise(l.taxableValue),
          );
          // The goods share is 70%, rounded half-up to the paisa.
          expect(toPaise(l.goodsTaxable ?? '0.00')).toBe(
            (toPaise(l.taxableValue) * 7000n * 2n + 10_000n) / 20_000n,
          );
        } else {
          expect(l.compositeRuleId).toBeNull();
          expect(l.goodsTaxable).toBeNull();
        }
      });
    });
  });
});
