import { describe, expect, it } from 'vitest';
import { canonicalJson, inputHash } from './hash';

describe('inputHash', () => {
  it('ignores the order of keys at every depth', () => {
    const a = { entityId: 1, contact: { name: 'A', phone: '98' }, tags: ['x', 'y'] };
    const b = { tags: ['x', 'y'], contact: { phone: '98', name: 'A' }, entityId: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(inputHash('crm.lead.create', a)).toBe(inputHash('crm.lead.create', b));
  });

  it('sorts the keys of objects inside lists, as a score rule read back from jsonb needs', () => {
    expect(canonicalJson(['source', { b: 1, a: { d: 2, c: 3 } }, 5])).toBe(
      canonicalJson(['source', { a: { c: 3, d: 2 }, b: 1 }, 5]),
    );
    expect(canonicalJson({ minDays: 1 })).not.toBe(canonicalJson({ minDays: 2 }));
  });

  it('keeps the order of a list', () => {
    expect(inputHash('c', { tags: ['x', 'y'] })).not.toBe(inputHash('c', { tags: ['y', 'x'] }));
  });

  it('tells commands apart for the same input', () => {
    expect(inputHash('crm.lead.create', {})).not.toBe(inputHash('org.entity.update', {}));
  });

  it('tells a changed value apart', () => {
    expect(inputHash('c', { price: '10.00' })).not.toBe(inputHash('c', { price: '10.01' }));
  });

  it('answers 64 hex characters, which the table checks', () => {
    expect(inputHash('c', undefined)).toMatch(/^[0-9a-f]{64}$/);
  });
});
