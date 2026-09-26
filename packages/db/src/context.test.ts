import { describe, expect, it } from 'vitest';
import { entityIdsLiteral } from './context';

describe('entityIdsLiteral', () => {
  it('renders a Postgres int[] literal', () => {
    expect(entityIdsLiteral([1, 2, 4])).toBe('{1,2,4}');
  });

  it('renders an empty array for an empty scope so policies deny', () => {
    expect(entityIdsLiteral([])).toBe('{}');
  });
});
