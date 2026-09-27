'use server';

import {
  SetCompositeRuleInput,
  SetTaxRateInput,
  type CompositeRuleRow,
  type TaxRateRow,
} from '@shakti/contracts';
import {
  executeCommand,
  setCompositeRule as setCompositeRuleCommand,
  setTaxRate as setTaxRateCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** Thin wrapper (docs/API.md §4): parse → request context → command → DTO. */
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
