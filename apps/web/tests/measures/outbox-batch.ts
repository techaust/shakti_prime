import { DeliveredEvent, newId } from '@shakti/contracts';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { percentiles, type Percentiles } from '../../scripts/measures/stats';
import {
  forgetEnsuredUrlGroups,
  publishWebhookJobs,
  qstashEventPublisher,
  type QStashConfig,
} from '../../src/workers/qstash';

/**
 * The queue's batch call at 200 messages (docs/10-status.md's G2 follow-up: the webhook sweep
 * publishes up to 200 rows in one call, and the outbox publisher uses the same call, unmeasured at
 * that size). QStash's dev server is a separate download (the `@upstash/qstash-cli` package, not in
 * this repository) and cannot be fetched offline, so the calls go to a local stand-in that records
 * each one and accepts every message: the figures are the app's side of the call (building,
 * signing nothing, sending and reading the answer of 200 messages through `@upstash/qstash`'s own
 * client) and the request's size; QStash's own time and its limits are measured only by a hosted
 * call.
 */

export const BATCH_SIZE = 200;

interface Recorded {
  method: string;
  path: string;
  bytes: number;
  /** Messages in a batch call. */
  messages: number;
}

/**
 * A stand-in that answers as QStash does: a message id for each message of a batch, and one for
 * any other call (a publish, a queue group's endpoint). Also the webhook load's queue when
 * processing is held off (`g2.ts webhooks --queue stand-in`).
 */
export async function queueStandIn(): Promise<{
  url: string;
  calls: Recorded[];
  close: () => Promise<void>;
}> {
  const calls: Recorded[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const path = new URL(req.url ?? '/', 'http://stand-in').pathname;
      let messages = 0;
      let answer: unknown = { messageId: `msg_${newId()}` };
      if (path === '/v2/batch') {
        const body = JSON.parse(raw.toString('utf8')) as unknown[];
        messages = body.length;
        answer = body.map(() => ({ messageId: `msg_${newId()}` }));
      }
      calls.push({ method: req.method ?? '', path, bytes: raw.length, messages });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    calls,
    close: () =>
      new Promise((done) => {
        server.close(() => {
          done();
        });
      }),
  };
}

/** 200 events as the outbox claims them: ids only in their payloads (BLUEPRINT §5.3). */
function events(): DeliveredEvent[] {
  return Array.from({ length: BATCH_SIZE }, (_, i) => {
    const created = i % 2 === 0;
    return DeliveredEvent.parse({
      id: newId(),
      sequence: String(1_000_000 + i),
      type: created ? 'crm.lead.created' : 'messaging.message.received',
      entityId: 1 + (i % 4),
      aggregateType: created ? 'opportunity' : 'message',
      aggregateId: newId(),
      payload: created
        ? { v: 1, opportunityId: newId(), accountId: newId() }
        : { v: 1, messageId: newId(), threadId: newId() },
    });
  });
}

export interface BatchCallResult {
  call: 'outbox publisher (event groups)' | 'webhook sweep (process jobs)';
  rounds: number;
  /** The whole call as the app makes it. */
  ms: Percentiles;
  /** The batch request's body, bytes. */
  bytes: number;
  messagesPerCall: number;
  /** Every message of every round answered as accepted. */
  allAccepted: boolean;
  /** Calls other than the batch (the outbox's queue groups, made sure of once per process). */
  otherCalls: number;
}

/** `rounds` batch calls of 200 messages each, through the outbox's and the sweep's publishers. */
export async function measureBatchCall(options: { rounds: number }): Promise<BatchCallResult[]> {
  const stand = await queueStandIn();
  const config: QStashConfig = {
    token: 'g2 measure stand-in, accepted by no queue',
    currentSigningKey: 'g2 measure current key',
    nextSigningKey: 'g2 measure next key',
    baseUrl: stand.url,
    publishUrl: 'http://localhost:3000/api/v1/workers/outbox/publish',
  };
  const results: BatchCallResult[] = [];
  try {
    forgetEnsuredUrlGroups();
    const publisher = qstashEventPublisher(config);
    const outboxMs: number[] = [];
    let outboxAccepted = true;
    for (let i = 0; i < options.rounds; i += 1) {
      const batch = events();
      const t0 = performance.now();
      const answers = await publisher.publish(batch);
      outboxMs.push(performance.now() - t0);
      outboxAccepted &&= answers.length === BATCH_SIZE && answers.every((a) => a.ok);
    }
    const outboxBatches = stand.calls.filter((c) => c.path === '/v2/batch');
    results.push({
      call: 'outbox publisher (event groups)',
      rounds: options.rounds,
      ms: percentiles(outboxMs),
      bytes: Math.max(...outboxBatches.map((c) => c.bytes)),
      messagesPerCall: Math.max(...outboxBatches.map((c) => c.messages)),
      allAccepted: outboxAccepted && outboxBatches.every((c) => c.messages === BATCH_SIZE),
      otherCalls: stand.calls.length - outboxBatches.length,
    });

    stand.calls.length = 0;
    const sweepMs: number[] = [];
    let sweepAccepted = true;
    for (let i = 0; i < options.rounds; i += 1) {
      const jobs = Array.from({ length: BATCH_SIZE }, () => {
        const inboxId = newId();
        return { inboxId, deduplicationId: `${inboxId}:s1` };
      });
      const t0 = performance.now();
      const taken = await publishWebhookJobs(config, jobs, 5_000);
      sweepMs.push(performance.now() - t0);
      sweepAccepted &&= taken.length === BATCH_SIZE && taken.every(Boolean);
    }
    const sweepBatches = stand.calls.filter((c) => c.path === '/v2/batch');
    results.push({
      call: 'webhook sweep (process jobs)',
      rounds: options.rounds,
      ms: percentiles(sweepMs),
      bytes: Math.max(...sweepBatches.map((c) => c.bytes)),
      messagesPerCall: Math.max(...sweepBatches.map((c) => c.messages)),
      allAccepted: sweepAccepted && sweepBatches.every((c) => c.messages === BATCH_SIZE),
      otherCalls: stand.calls.length - sweepBatches.length,
    });
  } finally {
    forgetEnsuredUrlGroups();
    await stand.close();
  }
  return results;
}
