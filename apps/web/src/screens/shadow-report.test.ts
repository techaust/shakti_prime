import { describe, expect, it } from 'vitest';
import {
  agreementShare,
  defaultShadowPeriod,
  istDay,
  periodProblem,
  signedPoints,
} from './shadow-report';

describe('the shadow report’s reading', () => {
  it('starts with the last 30 days in India', () => {
    // 20:00 UTC on the 9th is past midnight on the 10th in India.
    const now = new Date('2026-10-09T20:00:00Z');
    expect(istDay(now)).toBe('2026-10-10');
    expect(defaultShadowPeriod(now)).toEqual({ from: '2026-09-11', to: '2026-10-10' });
  });

  it('names what is wrong with a period', () => {
    expect(periodProblem(undefined, '2026-10-10')).toBe('periodMissing');
    expect(periodProblem('2026-10-10', '2026-10-01')).toBe('periodReversed');
    expect(periodProblem('2026-07-01', '2026-09-30')).toBeUndefined();
    expect(periodProblem('2026-07-01', '2026-10-01')).toBe('periodTooLong');
    expect(periodProblem('2026-10-10', '2026-10-10')).toBeUndefined();
  });

  it('writes a score change with its sign and the share agreed', () => {
    expect(signedPoints(5)).toBe('+5');
    expect(signedPoints(-3)).toBe('-3');
    expect(agreementShare(0, 0)).toBeUndefined();
    expect(agreementShare(2, 1)).toBe(67);
  });
});
