import {
  DomainError,
  hasGrant,
  IntegrationHealthResponse,
  type DeliveryCheck,
  type Principal,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  readAgentSpend,
  readOutboxHealth,
  runDeliveryProbe,
  type ExecuteOptions,
  type KeyValue,
} from '@shakti/domain';
import { logger } from '../log';
import { readDeliveryCheck, rememberProbe } from '../workers/events/probe';
import { lastPublisherRun } from '../workers/outbox';

/**
 * The page's own permission (docs/06-api.md §3.7). The outbox part is checked again in the database
 * by `app.outbox_health()`; the store's parts (the last run, the delivery check) have no database
 * guard, so they are refused here to anyone else.
 */
export function assertIntegrationHealth(principal: Principal): void {
  if (!hasGrant(principal.permissions, 'admin.integrations.write', 'all')) {
    throw new DomainError('forbidden', 'admin.integrations.write:all is required');
  }
}

/** A store that did not answer leaves its part of the page empty rather than failing the page. */
async function fromStore<T>(requestId: string, read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    logger.log('warn', 'integrations.store_unavailable', { requestId, error });
    return undefined;
  }
}

/**
 * Integration Health (`GET /api/v1/admin/integrations` and the page): the outbox by type and the
 * dead letters from the database, the AI spend per agent and company from the agents' runs (A1),
 * the last publisher run and the delivery check from the store. Webhooks, Tally connectors and
 * WhatsApp numbers have no source yet (Phase 2 and 5), so they answer empty.
 */
export async function readIntegrationHealth(
  principal: Principal,
  requestId: string,
  query: unknown,
  keyValue: KeyValue,
  now: Date = new Date(),
): Promise<IntegrationHealthResponse> {
  assertIntegrationHealth(principal);
  const outbox = await executeQuery(
    principal,
    { requestId },
    (context) => readOutboxHealth(context, query),
    { name: 'readIntegrationHealth' },
  );
  const aiSpend = await executeQuery(
    principal,
    { requestId },
    (context) => readAgentSpend(context, now),
    { name: 'readAgentSpend' },
  );
  const [lastRun, check] = await Promise.all([
    fromStore(requestId, () => lastPublisherRun(keyValue)),
    fromStore(requestId, () => readDeliveryCheck(keyValue, now)),
  ]);
  return IntegrationHealthResponse.parse({
    generatedAt: now.toISOString(),
    outbox: { byType: outbox.byType, lastPublisherRun: lastRun ?? null },
    deliveryCheck: check ?? null,
    webhooks: [],
    deadLetters: outbox.deadLetters,
    connectors: [],
    whatsapp: [],
    aiSpend,
  });
}

/**
 * The delivery check: runs `platform.probe.run`, remembers it for the page and answers where it
 * stands (usually `waiting`; locally, where the worker runs in this process, `arrived`).
 */
export async function startDeliveryCheck(
  principal: Principal,
  requestId: string,
  options: ExecuteOptions,
  keyValue: KeyValue,
): Promise<DeliveryCheck> {
  const probe = await executeCommand(principal, { requestId }, runDeliveryProbe, {}, options);
  await rememberProbe(keyValue, probe);
  const check = await readDeliveryCheck(keyValue, new Date(), probe);
  if (check === undefined) throw new DomainError('internal', 'the delivery check was not kept');
  return check;
}

/** Where one delivery check stands, for the page while it waits. */
export async function deliveryCheckStatus(
  principal: Principal,
  probe: { probeId: string; requestedAt: string },
  keyValue: KeyValue,
): Promise<DeliveryCheck> {
  assertIntegrationHealth(principal);
  const check = await readDeliveryCheck(keyValue, new Date(), probe);
  if (check === undefined) throw new DomainError('not_found', 'no such delivery check');
  return check;
}
