import { describe, expect, it } from 'vitest';
import { newReference } from './log';
import { referenceFromDigest } from './reference';

describe('support references (DESIGN.md §11)', () => {
  it('are six characters a person can read out without confusion', () => {
    for (const ref of [newReference(), referenceFromDigest('1234567890')]) {
      expect(ref).toMatch(/^[2-9A-HJKMNP-Z]{6}$/);
    }
  });

  it('derive the same reference from the same digest, and differ between digests', () => {
    expect(referenceFromDigest('3151485247')).toBe(referenceFromDigest('3151485247'));
    expect(referenceFromDigest('3151485247')).not.toBe(referenceFromDigest('3151485248'));
  });
});
