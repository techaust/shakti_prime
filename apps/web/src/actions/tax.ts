'use server';

// No screen calls these actions yet. The tax rates screen comes in Phase 1 with the minimal
// catalogue (docs/ROADMAP.md §3: items, HSN, tax rates), once the workshop inputs PRICE-4 (the
// HSN code and GST rate of each item) and PRICE-6 (the solar composite split) are answered and
// the CA has confirmed the golden set (ADR 0007, docs/phase0/workshop-pack.md).

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
