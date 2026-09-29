'use server';

// Admin › Integration Health (docs/design/phase1.md §5.2, docs/API.md §3.7). The dead-letter
// replay is `replayDeadLetter` in ./admin.

import {
  DeliveryProbeDto,
  type DeliveryCheck,
  type IntegrationHealthResponse,
} from '@shakti/contracts';
import { defaultAuthDeps } from '../auth/deps';
import {
  deliveryCheckStatus,
  readIntegrationHealth,
  startDeliveryCheck,
} from '../observability/integration-health';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** The page's data: the outbox by type, a page of dead letters, the last run, the last check. */
export async function integrationHealth(
  rawInput: unknown,
): Promise<ActionResult<IntegrationHealthResponse>> {
  return toResult('integrationHealth', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return readIntegrationHealth(principal, requestId, rawInput, defaultAuthDeps().keyValue);
  });
}

/**
 * "Check delivery speed": sends one delivery check and answers where it stands. The command takes
 * no input (`{}`); the form's idempotency key comes second, as with every command action.
 */
export async function runDeliveryCheck(
  _input: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DeliveryCheck>> {
  return toResult('runDeliveryCheck', async () => {
    const principal = await signedIn();
    const meta = await requestMeta();
    return startDeliveryCheck(
      principal,
      meta.requestId,
      commandOptions(meta, idempotencyKey),
      defaultAuthDeps().keyValue,
    );
  });
}

/** Where a delivery check stands, asked again while the page waits for it. */
export async function deliveryCheck(rawProbe: unknown): Promise<ActionResult<DeliveryCheck>> {
  return toResult('deliveryCheck', async () => {
    const principal = await signedIn();
    const probe = parseInput(DeliveryProbeDto, rawProbe);
    return deliveryCheckStatus(principal, probe, defaultAuthDeps().keyValue);
  });
}
