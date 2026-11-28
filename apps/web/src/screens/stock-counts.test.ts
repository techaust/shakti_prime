import { describe, expect, it } from 'vitest';
import { formatQty } from './inventory';
import {
  countedQtyFromTyped,
  countHref,
  countReviewHref,
  countSheetHref,
  countStateTone,
  formatSignedQty,
  resolveSerial,
} from './stock-counts';

describe('stock count screens', () => {
  it('link a count, its review and its sheet in the count’s company', () => {
    const id = '01990000-0000-7000-8000-000000000001';
    expect(countHref(2, id)).toBe(`/inventory/counts/${id}?company=2`);
    expect(countReviewHref(2, id)).toBe(`/inventory/counts/${id}/review?company=2`);
    expect(countSheetHref(2, id)).toBe(`/inventory/counts/${id}/sheet?company=2`);
  });

  it('give each state its badge tone', () => {
    expect(countStateTone('open')).toBe('neutral');
    expect(countStateTone('counting')).toBe('info');
    expect(countStateTone('review')).toBe('warning');
    expect(countStateTone('posted')).toBe('success');
    expect(countStateTone('cancelled')).toBe('neutral');
  });

  it('take a counted quantity of zero or more with up to three decimals', () => {
    expect(countedQtyFromTyped(' 38 ')).toBe('38');
    expect(countedQtyFromTyped('0')).toBe('0');
    expect(countedQtyFromTyped('1,250.5')).toBe('1250.5');
    expect(countedQtyFromTyped('2.125')).toBe('2.125');
    expect(countedQtyFromTyped('2.1255')).toBeUndefined();
    expect(countedQtyFromTyped('-1')).toBeUndefined();
    expect(countedQtyFromTyped('')).toBeUndefined();
    expect(countedQtyFromTyped('ten')).toBeUndefined();
    expect(countedQtyFromTyped('1234567890')).toBeUndefined();
  });

  it('resolve a scanned or typed serial in the scan field’s shape', () => {
    expect(resolveSerial('  ', [], null)).toEqual({ status: 'empty' });
    expect(resolveSerial(' SP-001 ', [], null)).toEqual({ status: 'ok', code: 'SP-001' });
    // A repeat in any case is the same serial.
    expect(resolveSerial('sp-001', ['SP-001'], null)).toEqual({
      status: 'repeat',
      code: 'sp-001',
    });
    // The item's pattern is anchored at both ends.
    expect(resolveSerial('SP-001', [], 'SP-\\d{3}')).toEqual({ status: 'ok', code: 'SP-001' });
    expect(resolveSerial('XSP-0011', [], 'SP-\\d{3}')).toEqual({
      status: 'pattern',
      code: 'XSP-0011',
    });
    // A pattern that does not compile checks nothing.
    expect(resolveSerial('anything', [], '([')).toEqual({ status: 'ok', code: 'anything' });
    expect(resolveSerial('anything', [], '')).toEqual({ status: 'ok', code: 'anything' });
  });

  it('show a difference with its sign, and zero with none', () => {
    expect(formatSignedQty('2.000', formatQty)).toBe('+2');
    expect(formatSignedQty('-1.500', formatQty)).toBe('-1.5');
    expect(formatSignedQty('-123456.000', formatQty)).toBe('-1,23,456');
    expect(formatSignedQty('0.000', formatQty)).toBe('0');
    expect(formatSignedQty('-0.000', formatQty)).toBe('0');
  });
});
