'use server';

// Settings › Tax calls these. The rates themselves are client data (workshop inputs PRICE-4 and
// PRICE-6, the CA's golden set, ADR 0007): nothing is seeded, Accounts enters them here.

import {
  SetCompositeRuleInput,
  SetTaxRateInput,
  type CompositeRuleRow,
  type TaxRateRow,
  type TaxSettingsDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  readTaxSettings as readTaxSettingsQuery,
  setCompositeRule as setCompositeRuleCommand,
  setTaxRate as setTaxRateCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** Thin wrapper (docs/06-api.md §4): parse → request context → command → DTO. */
export async function setTaxRate(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<TaxRateRow>> {
  return toResult('setTaxRate', async () => {
    const principal = await signedIn();
    const input = parseInput(SetTaxRateInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      setTaxRateCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** The goods and services split of a composite supply for a segment, from a date. */
export async function setCompositeRule(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CompositeRuleRow>> {
  return toResult('setCompositeRule', async () => {
    const principal = await signedIn();
    const input = parseInput(SetCompositeRuleInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      setCompositeRuleCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Settings › Tax: every GST rate and composite-supply rule with its period. */
export async function readTaxSettings(): Promise<ActionResult<TaxSettingsDto>> {
  return toResult('readTaxSettings', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => readTaxSettingsQuery(context), {
      name: 'readTaxSettings',
    });
  });
}
