import { memoryKeyValue } from '@shakti/domain';
import { memoryAlertSink } from '../../src/observability/alerts';
import {
  inProcessEventPublisher,
  OUTBOX_RUN_BUDGET_MS,
  publishOutbox,
} from '../../src/workers/outbox';

/** How long the seed may spend delivering; a backlog that outlasts it is left to the nudges. */
const DELIVER_LIMIT_MS = 2 * 60_000;

/**
 * Delivers every event the seed left waiting, in this process, as the journeys' server would on
 * its first request, so no journey's first change carries the seed's backlog (hardening batch 2,
 * item 1). The workers run with the stand-in AI transport (`AI_TRANSPORT=fake`), as the journeys'
 * server does wherever it is started, so the Triage and Knowledge workers call no vendor. Runs
 * until a run claims nothing (the events the workers raise are delivered too) or the limit
 * passes; an event whose worker failed waits out its backoff, as it would on the server.
 */
export async function deliverWaitingEvents(): Promise<{ delivered: number; runs: number }> {
  process.env.AI_TRANSPORT = 'fake';
  const keyValue = memoryKeyValue();
  const alerts = memoryAlertSink();
  const started = Date.now();
  let delivered = 0;
  let runs = 0;
  while (Date.now() - started < DELIVER_LIMIT_MS) {
    const counts = await publishOutbox({
      publisher: inProcessEventPublisher(keyValue),
      keyValue,
      alerts,
      budgetMs: OUTBOX_RUN_BUDGET_MS,
    });
    runs += 1;
    delivered += counts.published + counts.skipped;
    if (counts.claimed === 0) break;
  }
  return { delivered, runs };
}
