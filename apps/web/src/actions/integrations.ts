'use server';

// Admin › Integration Health (docs/03-roadmap-appendix/phase1.md §5.2, docs/06-api.md §3.7). The dead-letter
// replay is `replayDeadLetter` in ./admin; Process again of a failed webhook delivery is here.

import {
  DeliveryProbeDto,
  ReplayWebhookInput,
  type DeliveryCheck,
  type IntegrationHealthResponse,
  type ReplayedWebhookDto,
} from '@shakti/contracts';
import { defaultAuthDeps } from '../auth/deps';
import {
  deliveryCheckStatus,
  readIntegrationHealth,
  startDeliveryCheck,
} from '../observability/integration-health';
import { processAgain } from '../webhooks/replay';
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

/**
 * "Process again" on a failed webhook delivery (`webhooks.event.replay`, phase 2 design §5.1):
 * the row waits again and is sent to the worker once more.
 */
export async function processWebhookAgain(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ReplayedWebhookDto>> {
  return toResult('processWebhookAgain', async () => {
    const principal = await signedIn();
    const input = parseInput(ReplayWebhookInput, rawInput);
    const meta = await requestMeta();
    return processAgain(principal, meta.requestId, input, commandOptions(meta, idempotencyKey));
  });
}
