import { describe, expect, it } from 'vitest';
import { duplicateConfidence, matchText, type DuplicateFacts } from './duplicate-confidence';

const none: DuplicateFacts = {
  kind: 'customer',
  samePhone: false,
  sameName: false,
  sameVillage: false,
  sameCustomer: false,
};

/** Every combination of the four facts for one kind of pair. */
function everyFact(kind: DuplicateFacts['kind']): DuplicateFacts[] {
  const out: DuplicateFacts[] = [];
  for (let bits = 0; bits < 16; bits += 1) {
    out.push({
      kind,
      samePhone: (bits & 1) !== 0,
      sameName: (bits & 2) !== 0,
      sameVillage: (bits & 4) !== 0,
      sameCustomer: (bits & 8) !== 0,
    });
  }
  return out;
}

describe('duplicateConfidence', () => {
  it('puts nothing forward without a phone or a name in its village', () => {
    expect(duplicateConfidence(none)).toBeUndefined();
    expect(duplicateConfidence({ ...none, sameName: true })).toBeUndefined();
    expect(duplicateConfidence({ ...none, sameVillage: true })).toBeUndefined();
    // Two customers are never "the same customer"; only a lead pair reads that fact.
    expect(duplicateConfidence({ ...none, sameCustomer: true })).toBeUndefined();
  });

  it('rates a shared number by what else matches', () => {
    expect(duplicateConfidence({ ...none, samePhone: true })).toEqual({
      reason: 'phone',
      confidence: 70,
      signals: ['same_phone'],
    });
    expect(duplicateConfidence({ ...none, samePhone: true, sameVillage: true })).toEqual({
      reason: 'phone',
      confidence: 85,
      signals: ['same_phone', 'same_village'],
    });
    expect(
      duplicateConfidence({ ...none, samePhone: true, sameName: true, sameVillage: true }),
    ).toEqual({
      reason: 'phone',
      confidence: 95,
      signals: ['same_phone', 'same_name', 'same_village'],
    });
  });

  it('rates the same name in the same village below any shared number', () => {
    expect(duplicateConfidence({ ...none, sameName: true, sameVillage: true })).toEqual({
      reason: 'name_village',
      confidence: 60,
      signals: ['same_name', 'same_village'],
    });
  });

  it('rates two open leads of one customer as the same enquiry', () => {
    expect(
      duplicateConfidence({ ...none, kind: 'lead', sameCustomer: true, samePhone: true }),
    ).toEqual({ reason: 'phone', confidence: 95, signals: ['same_customer', 'same_phone'] });
  });

  it('never lowers the confidence when one more fact matches, for either kind of pair', () => {
    for (const kind of ['customer', 'lead'] as const) {
      for (const facts of everyFact(kind)) {
        const base = duplicateConfidence(facts)?.confidence ?? 0;
        for (const key of ['samePhone', 'sameName', 'sameVillage', 'sameCustomer'] as const) {
          if (facts[key]) continue;
          const more = duplicateConfidence({ ...facts, [key]: true })?.confidence ?? 0;
          expect(more).toBeGreaterThanOrEqual(base);
        }
      }
    }
  });

  it('answers a confidence from 1 to 100 and names each fact behind it', () => {
    for (const kind of ['customer', 'lead'] as const) {
      for (const facts of everyFact(kind)) {
        const found = duplicateConfidence(facts);
        if (found === undefined) continue;
        expect(found.confidence).toBeGreaterThanOrEqual(1);
        expect(found.confidence).toBeLessThanOrEqual(100);
        expect(found.signals.includes('same_phone')).toBe(facts.samePhone);
        expect(found.signals.includes('same_name')).toBe(facts.sameName);
        expect(found.signals.includes('same_village')).toBe(facts.sameVillage);
        expect(found.reason).toBe(
          facts.samePhone || (kind === 'lead' && facts.sameCustomer) ? 'phone' : 'name_village',
        );
      }
    }
  });
});

describe('matchText', () => {
  it('compares names and villages whatever their case and spacing', () => {
    expect(matchText('  Ram  Kumar ')).toBe('ram kumar');
    expect(matchText('RAM\tkumar')).toBe('ram kumar');
    expect(matchText('Sitapur')).toBe(matchText(' sitapur'));
  });
});
