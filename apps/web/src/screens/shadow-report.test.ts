import { describe, expect, it } from 'vitest';
import { istDay } from './ist';
import {
  agreementShare,
  defaultShadowPeriod,
  periodProblem,
  sampleHref,
  sampleQuery,
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

describe('the review sample’s address (G2 shadow pack)', () => {
  const now = new Date('2026-11-20T06:00:00Z');

  it('links a report’s company and period', () => {
    expect(sampleHref('concierge', 2, '2026-10-01', '2026-10-30')).toBe(
      '/admin/agents/concierge/sample?company=2&from=2026-10-01&to=2026-10-30',
    );
  });

  it('reads the company and period it names, within the viewer’s companies', () => {
    expect(
      sampleQuery({ company: '2', from: '2026-10-01', to: '2026-10-30' }, [1, 2], 1, now),
    ).toEqual({ entityId: 2, from: '2026-10-01', to: '2026-10-30' });
  });

  it('falls back for a company the viewer does not work for, or a period the report refuses', () => {
    expect(
      sampleQuery({ company: '4', from: '2026-10-01', to: '2026-10-30' }, [1, 2], 1, now),
    ).toEqual({ entityId: 1, from: '2026-10-01', to: '2026-10-30' });
    for (const period of [
      { from: '2026-10-30', to: '2026-10-01' },
      { from: '2026-01-01', to: '2026-10-01' },
      { from: '2026-13-01', to: '2026-13-02' },
      { from: ['2026-10-01'], to: '2026-10-30' },
      {},
    ]) {
      expect(sampleQuery({ company: '2', ...period }, [1, 2], 1, now)).toEqual({
        entityId: 2,
        from: '2026-10-22',
        to: '2026-11-20',
      });
    }
  });
});
