'use client';

import { useTranslations } from 'next-intl';
import { wordsOf } from '../../screens/audit';
import {
  BIN_KINDS,
  SERIAL_STATES,
  STOCK_REASONS,
  WAREHOUSE_KINDS,
} from '../../screens/contract-values';

function oneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/** A bin's kind in words; a code with no words yet reads as its own words, never raw. */
export function useBinKindText() {
  const t = useTranslations('inventory.binKinds');
  return (kind: string) => (oneOf(BIN_KINDS, kind) ? t(kind) : wordsOf(kind));
}

/** A hub's kind in words. */
export function useHubKindText() {
  const t = useTranslations('inventory.hubKinds');
  return (kind: string) => (oneOf(WAREHOUSE_KINDS, kind) ? t(kind) : wordsOf(kind));
}

/** Why stock moved, in words. */
export function useReasonText() {
  const t = useTranslations('inventory.reasons');
  return (reason: string) => (oneOf(STOCK_REASONS, reason) ? t(reason) : wordsOf(reason));
}

/** Where a serial stands, in words. */
export function useSerialStateText() {
  const t = useTranslations('inventory.serialStates');
  return (state: string) => (oneOf(SERIAL_STATES, state) ? t(state) : wordsOf(state));
}
