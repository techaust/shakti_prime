import { describe, expect, it } from 'vitest';
import {
  homeSections,
  meterPercent,
  metricNumber,
  parseSubject,
  parseTargetValue,
  periodParam,
  subjectValue,
  targetMet,
} from './home';

describe('homeSections', () => {
  it('gives each role its own section', () => {
    expect(homeSections(['tele_caller_cc'])).toEqual(['caller']);
    expect(homeSections(['tele_caller_lc'])).toEqual(['caller']);
    expect(homeSections(['sales_team_lead'])).toEqual(['lead']);
    expect(homeSections(['general_manager'])).toEqual(['manager']);
    expect(homeSections(['accounts'])).toEqual(['accounts']);
    expect(homeSections(['executive'])).toEqual(['executive']);
  });

  it('gives a role with no section none, so only the shortcuts show', () => {
    for (const role of [
      'store_manager',
      'inventory_manager',
      'project_manager',
      'field_engineer',
      'hr_admin',
    ] as const) {
      expect(homeSections([role])).toEqual([]);
    }
  });

  it('shows a person with several roles the sections of each, once, in the page order', () => {
    expect(homeSections(['accounts', 'tele_caller_cc', 'tele_caller_lc'])).toEqual([
      'caller',
      'accounts',
    ]);
    expect(homeSections(['executive', 'general_manager', 'sales_team_lead'])).toEqual([
      'lead',
      'manager',
      'executive',
    ]);
  });
});

describe('periodParam', () => {
  it('takes a known period and falls back to the day', () => {
    expect(periodParam('week')).toBe('week');
    expect(periodParam(['month', 'day'])).toBe('month');
    expect(periodParam('year')).toBe('day');
    expect(periodParam(undefined)).toBe('day');
  });
});

describe('meterPercent and targetMet', () => {
  it('fills a meter to the share of the target, to a full one at most', () => {
    expect(meterPercent(0.5)).toBe(50);
    expect(meterPercent(0.005)).toBe(1);
    expect(meterPercent(1)).toBe(100);
    expect(meterPercent(2.5)).toBe(100);
  });

  it('leaves a meter empty with no target or no progress', () => {
    expect(meterPercent(null)).toBe(0);
    expect(meterPercent(0)).toBe(0);
    expect(meterPercent(Number.NaN)).toBe(0);
  });

  it('calls a target met at its figure and above', () => {
    expect(targetMet(1)).toBe(true);
    expect(targetMet(1.2)).toBe(true);
    expect(targetMet(0.99)).toBe(false);
    expect(targetMet(null)).toBe(false);
  });
});

describe('metricNumber', () => {
  it('writes counts whole and kW with up to two decimals, grouped the Indian way', () => {
    expect(metricNumber('calls', 1200000)).toBe('12,00,000');
    expect(metricNumber('kw', 3.5)).toBe('3.5');
    expect(metricNumber('kw', 12.345)).toBe('12.35');
    expect(metricNumber('orders', 2)).toBe('2');
  });
});

describe('the Targets form', () => {
  it('names a person or a team in one value and reads it back', () => {
    expect(subjectValue('team', 'abc')).toBe('team:abc');
    expect(parseSubject('caller:abc')).toEqual({ scope: 'caller', id: 'abc' });
    expect(parseSubject('team:abc')).toEqual({ scope: 'team', id: 'abc' });
    expect(parseSubject('other:abc')).toBeUndefined();
    expect(parseSubject('caller:')).toBeUndefined();
    expect(parseSubject('')).toBeUndefined();
  });

  it('reads a typed figure with up to two decimals and refuses the rest', () => {
    expect(parseTargetValue('25')).toBe(25);
    expect(parseTargetValue(' 7.5 ')).toBe(7.5);
    expect(parseTargetValue('1,200')).toBe(1200);
    expect(parseTargetValue('0')).toBe(0);
    expect(parseTargetValue('-3')).toBeUndefined();
    expect(parseTargetValue('2.555')).toBeUndefined();
    expect(parseTargetValue('many')).toBeUndefined();
    expect(parseTargetValue('')).toBeUndefined();
  });
});
