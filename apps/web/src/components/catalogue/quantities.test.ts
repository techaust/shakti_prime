import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import { ITEM_UNITS } from '../../screens/contract-values';

const t = createTranslator({
  locale: 'en',
  messages: en,
  namespace: 'catalogue',
  timeZone: 'Asia/Kolkata',
});

describe('a kit quantity with its unit', () => {
  it('reads in the singular for one and in the plural otherwise, decimals included', () => {
    expect(t('quantities.metre', { count: 1 })).toBe('1 metre');
    expect(t('quantities.metre', { count: 30.5 })).toBe('30.5 metres');
    expect(t('quantities.metre', { count: 1.5 })).toBe('1.5 metres');
    expect(t('quantities.nos', { count: 1 })).toBe('1 piece');
    expect(t('quantities.nos', { count: 2 })).toBe('2 pieces');
    expect(t('quantities.kg', { count: 0.25 })).toBe('0.25 kilograms');
    expect(t('quantities.kw', { count: 3 })).toBe('3 kW');
  });

  it('has words for every unit', () => {
    for (const unit of ITEM_UNITS) {
      expect(t(`quantities.${unit}`, { count: 2 })).toMatch(/^2 \S/);
    }
  });
});
