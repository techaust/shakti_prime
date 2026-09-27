import { describe, expect, it } from 'vitest';
import { canonicalJson, inputHash } from './hash';

describe('inputHash', () => {
  it('ignores the order of keys at every depth', () => {
    const a = { entityId: 1, contact: { name: 'A', phone: '98' }, tags: ['x', 'y'] };
    const b = { tags: ['x', 'y'], contact: { phone: '98', name: 'A' }, entityId: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(inputHash('crm.lead.create', a)).toBe(inputHash('crm.lead.create', b));
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
