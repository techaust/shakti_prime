import { newId, type DeliveredEvent } from '@shakti/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({
  batchJSON: vi.fn<(messages: unknown[]) => Promise<unknown[]>>(),
  publishJSON: vi.fn<(message: unknown) => Promise<unknown>>(),
  options: [] as unknown[],
}));

vi.mock('@upstash/qstash', () => ({
  Client: class {
    constructor(options: unknown) {
      queue.options.push(options);
    }
    batchJSON = queue.batchJSON;
    publishJSON = queue.publishJSON;
  },
  Receiver: class {
    verify() {
      return Promise.reject(new Error('bad signature'));
    }
  },
}));

const { nudgeViaQStash, qstashConfig, qstashEventPublisher, verifyQStashSignature } =
  await import('./qstash');

const ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  QSTASH_TOKEN: 'qstash-value',
  QSTASH_CURRENT_SIGNING_KEY: 'qstash-current-value',
  QSTASH_NEXT_SIGNING_KEY: 'qstash-next-value',
  BETTER_AUTH_URL: 'https://bos.example.in',
};

function event(type: DeliveredEvent['type'] = 'crm.lead.created'): DeliveredEvent {
  return {
    id: newId(),
    sequence: '1',
    type,
    entityId: 1,
    aggregateType: 'opportunity',
    aggregateId: newId(),
    payload: { v: 1 },
  };
}

beforeEach(() => {
  queue.batchJSON.mockReset();
  queue.publishJSON.mockReset();
  queue.options.length = 0;
});

describe('qstashConfig', () => {
  it('names the publisher route under the app address', () => {
    expect(qstashConfig(ENV)).toEqual({
      token: 'qstash-value',
      currentSigningKey: 'qstash-current-value',
      nextSigningKey: 'qstash-next-value',
      baseUrl: undefined,
      publishUrl: 'https://bos.example.in/api/v1/workers/outbox/publish',
    });
    expect(qstashConfig({ ...ENV, QSTASH_URL: 'https://qstash-eu.example.io' })?.baseUrl).toBe(
      'https://qstash-eu.example.io',
    );
  });

  it.each([
    'QSTASH_TOKEN',
    'QSTASH_CURRENT_SIGNING_KEY',
    'QSTASH_NEXT_SIGNING_KEY',
    'BETTER_AUTH_URL',
  ])('is nothing without %s', (name) => {
    expect(qstashConfig({ ...ENV, [name]: '' })).toBeUndefined();
  });
});

describe('qstashEventPublisher', () => {
  const config = qstashConfig(ENV);
  if (config === undefined) throw new Error('test configuration is incomplete');

  it('sends one batch, each event to its type group with its id as the deduplication id', async () => {
    const events = [event(), event('pricing.price.changed')];
    queue.batchJSON.mockResolvedValue([
      [{ messageId: 'm1', url: 'u' }],
      [{ messageId: 'm2', url: 'u' }],
    ]);
    const results = await qstashEventPublisher(config).publish(events);
    expect(queue.batchJSON).toHaveBeenCalledWith([
      { urlGroup: 'evt-crm.lead.created', body: events[0], deduplicationId: events[0]?.id },
      { urlGroup: 'evt-pricing.price.changed', body: events[1], deduplicationId: events[1]?.id },
    ]);
    expect(results).toEqual(events.map((e) => ({ id: e.id, ok: true })));
    expect(queue.options[0]).toMatchObject({ enableTelemetry: false, devMode: false });
  });

  it('fails an event the queue refused or did not answer for', async () => {
    const events = [event(), event(), event()];
    queue.batchJSON.mockResolvedValue([{ error: 'url group not found' }, []]);
    const results = await qstashEventPublisher(config).publish(events);
    expect(results.map((r) => r.ok)).toEqual([false, false, false]);
    expect(results[0]).toMatchObject({ error: 'queue_refused' });
  });

  it('sends nothing for an empty run', async () => {
    expect(await qstashEventPublisher(config).publish([])).toEqual([]);
    expect(queue.batchJSON).not.toHaveBeenCalled();
  });
});

describe('the nudge and the signature check', () => {
  const config = qstashConfig(ENV);
  if (config === undefined) throw new Error('test configuration is incomplete');

  it('asks QStash to call the publisher route', async () => {
    queue.publishJSON.mockResolvedValue({ messageId: 'm' });
    await nudgeViaQStash(config);
    expect(queue.publishJSON).toHaveBeenCalledWith({
      url: 'https://bos.example.in/api/v1/workers/outbox/publish',
      body: {},
      retries: 1,
    });
  });

  it('refuses a missing or failing signature without throwing', async () => {
    expect(await verifyQStashSignature(config, null, '{}')).toBe(false);
    expect(await verifyQStashSignature(config, '', '{}')).toBe(false);
    expect(await verifyQStashSignature(config, 'a.b.c', '{}')).toBe(false);
  });
});
