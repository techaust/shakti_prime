'use client';

import type { ItemCategory, ItemUnit } from '@shakti/contracts';
import { useTranslations } from 'next-intl';
import { oneOf, wordsOf } from '../../screens/audit';
import {
  ITEM_CATEGORIES,
  ITEM_UNITS,
  NUMERIC_SPEC_KEYS,
  SPEC_KEYS,
  type NumericSpecKey,
  type SpecKey,
} from '../../screens/contract-values';

/** The words for an item's category, unit and specifications, for every screen that shows them. */
export function useCatalogueText() {
  const t = useTranslations('catalogue');
  const category = (value: string) =>
    oneOf<ItemCategory>(ITEM_CATEGORIES, value) ? t(`categories.${value}`) : wordsOf(value);
  const unit = (value: string) =>
    oneOf<ItemUnit>(ITEM_UNITS, value) ? t(`units.${value}`) : wordsOf(value);
  const specLabel = (key: string) =>
    oneOf<SpecKey>(SPEC_KEYS, key) ? t(`specs.${key}`) : wordsOf(key);
  /** A specification's value with its unit, or a choice in words: `5 HP`, `Three phase`. */
  const specValue = (key: string, value: string | number) => {
    if (typeof value === 'number') {
      return oneOf<NumericSpecKey>(NUMERIC_SPEC_KEYS, key)
        ? t(`specValues.${key}`, { value: value.toLocaleString('en-IN') })
        : value.toLocaleString('en-IN');
    }
    if (key === 'phase' && (value === 'single' || value === 'three')) {
      return t(`choices.phase.${value}`);
    }
    if (key === 'pumpType' && (value === 'surface' || value === 'submersible')) {
      return t(`choices.pumpType.${value}`);
    }
    return key === 'material' ? value : wordsOf(value);
  };
  return { category, unit, specLabel, specValue };
}
