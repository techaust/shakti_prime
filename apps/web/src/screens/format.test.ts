import { describe, expect, it } from 'vitest';
import { describeDevice, formatDateTime, formatPhone, moneyFromTyped } from './format';

describe('screen formats (DESIGN.md §9)', () => {
  it('shows an instant as DD-MM-YYYY HH:mm in IST, 24-hour', () => {
    expect(formatDateTime('2026-09-27T18:45:00Z')).toBe('28-09-2026 00:15');
    expect(formatDateTime('2026-01-05T08:05:00Z')).toBe('05-01-2026 13:35');
  });

  it('groups an Indian mobile the way people read it and leaves other numbers alone', () => {
    expect(formatPhone('+919812345678')).toBe('+91 98123 45678');
    expect(formatPhone('+14155550100')).toBe('+14155550100');
  });

  it('reads a typed price as a two-decimal amount without rounding it', () => {
    expect(moneyFromTyped('24,750')).toBe('24750.00');
    expect(moneyFromTyped('₹ 1,24,750.5')).toBe('124750.50');
    expect(moneyFromTyped('0099.99')).toBe('99.99');
    expect(moneyFromTyped('12.345')).toBeUndefined();
    expect(moneyFromTyped('-5')).toBeUndefined();
    expect(moneyFromTyped('')).toBeUndefined();
    expect(moneyFromTyped('abc')).toBeUndefined();
  });

  it('names the browser and the system of a sign-in', () => {
    expect(
      describeDevice(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
      ),
    ).toEqual({ browser: 'chrome', system: 'android' });
    expect(
      describeDevice(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
      ),
    ).toEqual({ browser: 'edge', system: 'windows' });
    expect(
      describeDevice(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'safari', system: 'iphone' });
    expect(describeDevice(null)).toEqual({ browser: 'other', system: 'other' });
  });
});
