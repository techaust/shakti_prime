import {
  newId,
  type CompositeRuleRow,
  type PlaceOfSupply,
  type TaxedLine,
  type TaxRateRow,
} from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { compositeSplit, resolveCompositeRule } from './composite';
import { computeDocument } from './compute-document';
import { computeLine } from './compute-line';
import { placeOfSupply } from './place-of-supply';
import { resolveRate } from './resolve-rate';

// Rates in these fixtures show the method only; they are not the notified GST rates.

const PUMP_ITEM = newId();
const OTHER_ITEM = newId();

function rate(over: Partial<TaxRateRow>): TaxRateRow {
  return {
    id: newId(),
    hsn: '8413',
    itemId: null,
    ratePct: '12.00',
    effectiveFrom: '2025-04-01',
    effectiveTo: null,
    ...over,
  };
}

const hsnOld = rate({ ratePct: '12.00', effectiveFrom: '2025-04-01', effectiveTo: '2026-04-01' });
const hsnNew = rate({ ratePct: '5.00', effectiveFrom: '2026-04-01' });
const itemRow = rate({ hsn: null, itemId: PUMP_ITEM, ratePct: '18.00', effectiveTo: '2026-10-01' });
const RATES = [hsnOld, hsnNew, itemRow];

/** An instant from its IST wall-clock time. */
function ist(local: string): Date {
  return new Date(`${local}+05:30`);
}

describe('resolveRate', () => {
  it.each([
    ['the last millisecond of 31 March IST keeps the old rate', '2026-03-31T23:59:59.999', hsnOld],
    ['midnight IST on 1 April takes the new rate', '2026-04-01T00:00:00.000', hsnNew],
    ['18:29 UTC on 31 March is still 31 March in IST', '2026-03-31T23:59:00.000', hsnOld],
    ['a date in the middle of a period', '2025-12-15T10:00:00.000', hsnOld],
  ])('HSN boundary: %s', (_label, local, expected) => {
    expect(resolveRate(RATES, { hsn: '8413', itemId: OTHER_ITEM, on: ist(local) })).toBe(expected);
  });

  it('midnight IST is 18:30 UTC the day before', () => {
    const on = new Date('2026-03-31T18:30:00.000Z');
    expect(resolveRate(RATES, { hsn: '8413', itemId: null, on })).toBe(hsnNew);
  });

  it('an item row wins over the HSN row', () => {
    expect(
      resolveRate(RATES, { hsn: '8413', itemId: PUMP_ITEM, on: ist('2026-05-01T12:00:00') }),
    ).toBe(itemRow);
  });

  it('an item row past its end falls back to the HSN row (effective_to is exclusive)', () => {
    expect(
      resolveRate(RATES, { hsn: '8413', itemId: PUMP_ITEM, on: ist('2026-10-01T00:00:00') }),
    ).toBe(hsnNew);
    expect(
      resolveRate(RATES, { hsn: '8413', itemId: PUMP_ITEM, on: ist('2026-09-30T23:59:59.999') }),
    ).toBe(itemRow);
  });

  it('an HSN query never picks an item row of the same HSN field', () => {
    const itemWithHsn = rate({ hsn: null, itemId: OTHER_ITEM, ratePct: '28.00' });
    expect(
      resolveRate([itemWithHsn, hsnNew], {
        hsn: '8413',
        itemId: null,
        on: ist('2026-05-01T00:00:00'),
      }),
    ).toBe(hsnNew);
  });

  it.each([
    ['before any row', { hsn: '8413', itemId: null, on: ist('2025-03-31T23:59:59') }],
    ['an HSN with no row', { hsn: '8541', itemId: null, on: ist('2026-05-01T00:00:00') }],
    ['no HSN and no item row', { hsn: null, itemId: OTHER_ITEM, on: ist('2026-05-01T00:00:00') }],
  ])('refuses with tax_rate_missing: %s', (_label, query) => {
    expect(() => resolveRate(RATES, query)).toThrow(
      expect.objectContaining({
        code: 'validation_failed',
        details: expect.objectContaining({ reason: 'tax_rate_missing' }) as unknown,
      }),
    );
  });

  it('treats two live rows for one HSN as a fault, never a choice', () => {
    const twin = rate({ ratePct: '18.00', effectiveFrom: '2026-04-01' });
    expect(() =>
      resolveRate([hsnNew, twin], { hsn: '8413', itemId: null, on: ist('2026-05-01T00:00:00') }),
    ).toThrow(expect.objectContaining({ code: 'internal' }));
  });
});

describe('placeOfSupply', () => {
  const GJ_GSTIN = '24ABCDE1234F1Z5';
  it.each<[string, Parameters<typeof placeOfSupply>[0], PlaceOfSupply]>([
    [
      'site in the entity state is intra',
      { siteStateCode: '27', accountGstin: GJ_GSTIN, entityStateCode: '27' },
      { stateCode: '27', kind: 'intra', source: 'site' },
    ],
    [
      'site in another state is inter, even with a same-state GSTIN',
      { siteStateCode: '24', accountGstin: '27ABCDE1234F1Z5', entityStateCode: '27' },
      { stateCode: '24', kind: 'inter', source: 'site' },
    ],
    [
      'no site: the GSTIN state',
      { siteStateCode: null, accountGstin: GJ_GSTIN, entityStateCode: '27' },
      { stateCode: '24', kind: 'inter', source: 'account_gstin' },
    ],
    [
      'no site, GSTIN of the entity state',
      { accountGstin: '27ABCDE1234F1Z5', entityStateCode: '27' },
      { stateCode: '27', kind: 'intra', source: 'account_gstin' },
    ],
    [
      'no site and no GSTIN: the entity state',
      { siteStateCode: null, accountGstin: null, entityStateCode: '27' },
      { stateCode: '27', kind: 'intra', source: 'entity' },
    ],
    [
      'a malformed GSTIN is ignored',
      { accountGstin: '24-not-a-gstin', entityStateCode: '27' },
      { stateCode: '27', kind: 'intra', source: 'entity' },
    ],
    [
      'a malformed site state is ignored',
      { siteStateCode: '7', accountGstin: GJ_GSTIN, entityStateCode: '27' },
      { stateCode: '24', kind: 'inter', source: 'account_gstin' },
    ],
  ])('%s', (_label, parties, expected) => {
    expect(placeOfSupply(parties)).toEqual(expected);
  });

  it('refuses an entity without a state code', () => {
    expect(() => placeOfSupply({ entityStateCode: 'MH' })).toThrow(
      expect.objectContaining({ code: 'internal' }),
    );
  });
});

function rule(over: Partial<CompositeRuleRow> = {}): CompositeRuleRow {
  return {
    id: newId(),
    segment: 'residential_rooftop',
    goodsSharePct: '70.00',
    servicesSharePct: '30.00',
    goodsRatePct: '12.00',
    servicesRatePct: '18.00',
    effectiveFrom: '2025-04-01',
    effectiveTo: null,
    ...over,
  };
}

describe('composite supply', () => {
  const rooftop = rule();
  const epc = rule({ segment: 'commercial_epc' });
  const on = ist('2026-05-01T09:00:00');

  it.each([
    ['a works contract in rooftop uses the rooftop rule', 'residential_rooftop', true, rooftop],
    ['a works contract in commercial EPC uses its rule', 'commercial_epc', true, epc],
    ['a supply-only rooftop line is taxed at its own rate', 'residential_rooftop', false, null],
    ['farmer pumps are never composite', 'farmer_pumps', true, null],
    ['dealer wholesale is never composite', 'dealer_wholesale', true, null],
  ] as const)('%s', (_label, segment, worksContract, expected) => {
    expect(resolveCompositeRule([rooftop, epc], { segment, worksContract, on })).toBe(expected);
  });

  it('refuses a works-contract line with no effective rule', () => {
    const ended = rule({ effectiveTo: '2026-05-01' });
    expect(() =>
      resolveCompositeRule([ended], { segment: 'residential_rooftop', worksContract: true, on }),
    ).toThrow(
      expect.objectContaining({
        code: 'validation_failed',
        details: expect.objectContaining({ reason: 'composite_rule_missing' }) as unknown,
      }),
    );
  });

  it.each([
    [10_000_000n, 7_000_000n, 3_000_000n],
    [1n, 1n, 0n], // 0.7 paisa rounds up to the goods part
    [3n, 2n, 1n], // 2.1 paise
    [5n, 4n, 1n], // 3.5 paise rounds up
    [12_345_678n, 8_641_975n, 3_703_703n], // 8,641,974.6 rounds up
  ])('splits %s paise 70:30 into %s and %s', (taxable, goods, services) => {
    const parts = compositeSplit(rooftop, taxable);
    expect(parts.goodsTaxable).toBe(goods);
    expect(parts.servicesTaxable).toBe(services);
    expect(parts.goodsTaxable + parts.servicesTaxable).toBe(taxable);
    expect(parts.goodsRateBp).toBe(1200n);
    expect(parts.servicesRateBp).toBe(1800n);
  });
});

const INTRA: PlaceOfSupply = { stateCode: '27', kind: 'intra', source: 'entity' };
const INTER: PlaceOfSupply = { stateCode: '24', kind: 'inter', source: 'account_gstin' };
const r18 = rate({ ratePct: '18.00' });
const r5 = rate({ ratePct: '5.00' });

describe('computeLine', () => {
  it.each<[string, Parameters<typeof computeLine>[0], Partial<TaxedLine>]>([
    [
      'intra 18%: CGST and SGST at 9% each',
      { qty: '1', unitPrice: '1000.00', rate: r18, composite: null, supply: INTRA },
      { taxableValue: '1000.00', cgst: '90.00', sgst: '90.00', igst: '0.00', lineTotal: '1180.00' },
    ],
    [
      'inter 18%: IGST at the full rate',
      { qty: '1', unitPrice: '1000.00', rate: r18, composite: null, supply: INTER },
      { taxableValue: '1000.00', cgst: '0.00', sgst: '0.00', igst: '180.00', lineTotal: '1180.00' },
    ],
    [
      'a half paisa on each half rate rounds up on both heads',
      { qty: '1', unitPrice: '0.20', rate: r5, composite: null, supply: INTRA },
      { taxableValue: '0.20', cgst: '0.01', sgst: '0.01', igst: '0.00', lineTotal: '0.22' },
    ],
    [
      'the same line inter-state has no half to round',
      { qty: '1', unitPrice: '0.20', rate: r5, composite: null, supply: INTER },
      { taxableValue: '0.20', igst: '0.01', lineTotal: '0.21' },
    ],
    [
      'below half a paisa rounds down',
      { qty: '1', unitPrice: '0.05', rate: r5, composite: null, supply: INTRA },
      { taxableValue: '0.05', cgst: '0.00', sgst: '0.00', lineTotal: '0.05' },
    ],
    [
      'the taxable value rounds half-up to the paisa (2.5 × 99.99 = 249.975)',
      { qty: '2.5', unitPrice: '99.99', rate: r18, composite: null, supply: INTER },
      { taxableValue: '249.98', igst: '45.00', lineTotal: '294.98' },
    ],
    [
      'a three-decimal quantity (0.333 × 10.00 = 3.33)',
      { qty: '0.333', unitPrice: '10.00', rate: r18, composite: null, supply: INTRA },
      { taxableValue: '3.33', cgst: '0.30', sgst: '0.30', lineTotal: '3.93' },
    ],
    [
      'a zero rate',
      {
        qty: '4',
        unitPrice: '250.00',
        rate: rate({ ratePct: '0.00' }),
        composite: null,
        supply: INTRA,
      },
      { taxableValue: '1000.00', cgst: '0.00', sgst: '0.00', lineTotal: '1000.00' },
    ],
    [
      'a fractional half rate (0.25% → 0.125% each)',
      {
        qty: '1',
        unitPrice: '1000.00',
        rate: rate({ ratePct: '0.25' }),
        composite: null,
        supply: INTRA,
      },
      { cgst: '1.25', sgst: '1.25', lineTotal: '1002.50' },
    ],
  ])('%s', (_label, input, expected) => {
    expect(computeLine(input)).toMatchObject(expected);
  });

  it('snapshots the rate id and no composite id for a normal line', () => {
    const line = computeLine({
      qty: '1',
      unitPrice: '1.00',
      rate: r18,
      composite: null,
      supply: INTRA,
    });
    expect(line.taxRateId).toBe(r18.id);
    expect(line.compositeRuleId).toBeNull();
    expect(line.goodsTaxable).toBeNull();
    expect(line.servicesTaxable).toBeNull();
    expect(line.supplyKind).toBe('intra');
  });

  it('taxes a composite line by its parts and snapshots the rule', () => {
    const composite = rule();
    const intra = computeLine({
      qty: '1',
      unitPrice: '100000.00',
      rate: r18,
      composite,
      supply: INTRA,
    });
    expect(intra).toEqual({
      taxRateId: null,
      compositeRuleId: composite.id,
      supplyKind: 'intra',
      taxableValue: '100000.00',
      goodsTaxable: '70000.00',
      servicesTaxable: '30000.00',
      cgst: '6900.00',
      sgst: '6900.00',
      igst: '0.00',
      lineTotal: '113800.00',
    });
    const inter = computeLine({
      qty: '1',
      unitPrice: '100000.00',
      rate: null,
      composite,
      supply: INTER,
    });
    expect(inter).toMatchObject({ igst: '13800.00', cgst: '0.00', lineTotal: '113800.00' });
  });

  it('rounds a composite tax head once for the line', () => {
    // 0.03: goods 0.02 at 12% = 0.0024, services 0.01 at 18% = 0.0018; IGST 0.0042 → 0.00.
    const line = computeLine({
      qty: '1',
      unitPrice: '0.03',
      rate: null,
      composite: rule(),
      supply: INTER,
    });
    expect(line).toMatchObject({ goodsTaxable: '0.02', servicesTaxable: '0.01', igst: '0.00' });
  });

  it('refuses a line with neither a rate nor a composite rule', () => {
    expect(() =>
      computeLine({ qty: '1', unitPrice: '1.00', rate: null, composite: null, supply: INTRA }),
    ).toThrow(
      expect.objectContaining({
        code: 'validation_failed',
        details: expect.objectContaining({ reason: 'tax_rate_missing' }) as unknown,
      }),
    );
  });
});

describe('computeDocument', () => {
  function line(total: string, tax = '0.00'): TaxedLine {
    return {
      taxRateId: null,
      compositeRuleId: null,
      supplyKind: 'inter',
      taxableValue: total,
      goodsTaxable: null,
      servicesTaxable: null,
      cgst: '0.00',
      sgst: '0.00',
      igst: tax,
      lineTotal: total,
    };
  }

  it.each([
    ['49 paise round down', ['100.49'], '-0.49', '100.00'],
    ['50 paise round up', ['100.50'], '0.50', '101.00'],
    ['51 paise round up', ['100.00', '0.51'], '0.49', '101.00'],
    ['a whole rupee needs no round-off', ['250.00'], '0.00', '250.00'],
    ['an empty document', [], '0.00', '0.00'],
  ])('%s', (_label, totals, roundOff, grandTotal) => {
    const document = computeDocument(totals.map((t) => line(t)));
    expect(document.roundOff).toBe(roundOff);
    expect(document.grandTotal).toBe(grandTotal);
  });

  it('sums each head from the rounded line amounts', () => {
    const a = computeLine({
      qty: '1',
      unitPrice: '0.20',
      rate: r5,
      composite: null,
      supply: INTRA,
    });
    const b = computeLine({
      qty: '3',
      unitPrice: '0.20',
      rate: r5,
      composite: null,
      supply: INTRA,
    });
    // Each line rounds its own half-paisa: 0.01 + 0.02 (0.015 up), not 0.8 × 2.5% = 0.02.
    expect(computeDocument([a, b])).toEqual({
      subtotal: '0.80',
      cgst: '0.03',
      sgst: '0.03',
      igst: '0.00',
      taxTotal: '0.06',
      roundOff: '0.14',
      grandTotal: '1.00',
    });
  });
});
