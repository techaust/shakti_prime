'use client';

import { useTranslations } from 'next-intl';
import { wordsOf } from '../../screens/audit';
import { DEFAULT_PROJECT_STEPS } from '../../screens/contract-values';
import { isOneOf } from '../../screens/customers';

/**
 * A step's name: the Executive's words from the checklist, else the standard step's name from the
 * catalogue, else its key in plain words.
 */
export function useStepName(): (step: { key: string; title: string | null }) => string {
  const t = useTranslations('projects');
  return ({ key, title }) => {
    if (title !== null) return title;
    return isOneOf(DEFAULT_PROJECT_STEPS, key) ? t(`defaultSteps.${key}`) : wordsOf(key);
  };
}
