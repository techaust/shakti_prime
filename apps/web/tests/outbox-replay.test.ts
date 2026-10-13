import { newId, type Principal } from '@shakti/contracts';
import { closeOutboxDb, holdBackFailedEvent } from '@shakti/db/outbox';
import { asMigrator, asOutboxPublisher, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { executeCommand, memoryKeyValue, replayDeadLetter } from '@shakti/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAlertSink } from '../src/observability/alerts';

// The QStash client as the publisher calls it: every batch is kept, and `answer` decides what the
// queue says for each message.
const queue = vi.hoisted(() => ({
  batches: [] as { deduplicationId: string; body: { id?: string } }[][],
  answer: ((): unknown => [{ messageId: 'm', url: 'u' }]) as (message: {
    deduplicationId: string;
  }) => unknown,
}));
vi.mock('@upstash/qstash', () => ({
  Client: class {
    batchJSON(messages: { deduplicationId: string; body: { id?: string } }[]) {
      queue.batches.push(messages);
      return Promise.resolve(messages.map((m) => queue.answer(m)));
    }
    urlGroups = { addEndpoints: () => Promise.resolve() };
  },
  Receiver: class {
    verify() {
      return Promise.resolve(false);
    }
  },
}));

const { qstashConfig, qstashEventPublisher } = await import('../src/workers/qstash');
const { publishOutbox } = await import('../src/workers/outbox');

const configured = qstashConfig({
  NODE_ENV: 'test',
  QSTASH_TOKEN: 'outbox-replay-test-token',
  QSTASH_CURRENT_SIGNING_KEY: 'outbox-replay-test-current-signing-key',
  QSTASH_NEXT_SIGNING_KEY: 'outbox-replay-test-next-signing-key',
  BETTER_AUTH_URL: 'https://bos.example.in',
});
if (configured === undefined) throw new Error('test configuration is incomplete');
const config = configured;

let executive: Principal;

beforeAll(async () => {
  executive = await createTestPrincipal('executive');
});
beforeEach(() => {
  queue.batches.length = 0;
  queue.answer = () => [{ messageId: 'm', url: 'u' }];
});
afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

/** One run of the publisher against the mocked queue, with nothing sent to Sentry. */
function run() {
  return publishOutbox({
    publisher: qstashEventPublisher(config),
    keyValue: memoryKeyValue(),
    alerts: memoryAlertSink(),
  });
}

/** The deduplication ids this event was sent under, in order. */
function sentUnder(id: string): string[] {
  return queue.batches.flat().filter((m) => m.body.id === id).map((m) => m.deduplicationId);
}

async function row(id: string) {
  const [found] = await asOutboxPublisher(
    (p) => p<
      {
        published_at: Date | null;
        dead_lettered_at: Date | null;
        last_error: string | null;
        replays: number;
      }[]
    >`select published_at, dead_lettered_at, last_error, replays from outbox_events
       where id = ${id}`,
  );
  return found;
}

/**
 * An event delivered to its worker that QStash then gave up on: the publisher sends it, the
 * failure callback holds it back (`worker_failed`), as after an outage of the worker.
 */
async function heldBackEvent(): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id,
                                        payload_json)
             values (${id}, 1, 'platform.probe.requested', 'delivery_probe', ${newId()},
                     ${m.json({ v: 1, requestedAt: new Date().toISOString() })})`,
  );
  await run();
  expect(sentUnder(id)).toEqual([id]);
  expect(await holdBackFailedEvent(id, 'worker_failed')).toBe('held');
  return id;
}

function sendAgain(eventId: string) {
  return executeCommand(executive, { entityIds: [1, 2, 3, 4] }, replayDeadLetter, { eventId });
}

describe('Send again with the QStash publisher (audit 2026-10, DATA-1)', () => {
  it('sends a replayed event under a new deduplication id each time, so the queue delivers it again', async () => {
    const id = await heldBackEvent();
    await sendAgain(id);
    expect((await row(id))?.replays).toBe(1);
    await run();
    expect(sentUnder(id)).toEqual([id, `${id}:1`]);
    expect(await row(id)).toMatchObject({ dead_lettered_at: null, last_error: null });
    expect((await row(id))?.published_at).toBeInstanceOf(Date);

    // Its worker fails again, and Send again starts a third generation.
    expect(await holdBackFailedEvent(id, 'worker_failed')).toBe('held');
    await sendAgain(id);
    await run();
    expect(sentUnder(id)).toEqual([id, `${id}:1`, `${id}:2`]);
    expect((await row(id))?.replays).toBe(2);
  });

  it('holds back a replay the queue answers as already sent, instead of marking it delivered', async () => {
    const id = await heldBackEvent();
    await sendAgain(id);
    queue.answer = (m) =>
      m.deduplicationId === `${id}:1`
        ? [{ messageId: 'm', url: 'u', deduplicated: true }]
        : [{ messageId: 'm', url: 'u' }];
    const counts = await run();
    expect(counts.deadLettered).toBeGreaterThanOrEqual(1);
    const after = await row(id);
    expect(after).toMatchObject({ published_at: null, last_error: 'queue_deduplicated' });
    expect(after?.dead_lettered_at).toBeInstanceOf(Date);
  });
});
