import { newId, type DeliveredEvent } from '@shakti/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queue = vi.hoisted(() => ({
  batchJSON: vi.fn<(messages: unknown[]) => Promise<unknown[]>>(),
  publishJSON: vi.fn<(message: unknown) => Promise<unknown>>(),
  addEndpoints: vi.fn<(group: unknown) => Promise<void>>(),
  options: [] as unknown[],
}));

vi.mock('@upstash/qstash', () => ({
  Client: class {
    constructor(options: unknown) {
      queue.options.push(options);
    }
    batchJSON = queue.batchJSON;
    publishJSON = queue.publishJSON;
    urlGroups = { addEndpoints: queue.addEndpoints };
  },
  Receiver: class {
    verify() {
      return Promise.reject(new Error('bad signature'));
    }
  },
}));

const {
  forgetEnsuredUrlGroups,
  nudgeViaQStash,
  publishImportCommit,
  qstashConfig,
  qstashEventPublisher,
  verifyQStashSignature,
} = await import('./qstash');

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
  queue.addEndpoints.mockReset();
  queue.addEndpoints.mockResolvedValue(undefined);
  queue.options.length = 0;
  forgetEnsuredUrlGroups();
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

  it('sends one batch, each event to its type group with its id as the deduplication id and the failure callback', async () => {
    const events = [event(), event('pricing.price.changed')];
    queue.batchJSON.mockResolvedValue([
      [{ messageId: 'm1', url: 'u' }],
      [{ messageId: 'm2', url: 'u' }],
    ]);
    const results = await qstashEventPublisher(config).publish(events);
    expect(queue.batchJSON).toHaveBeenCalledWith([
      {
        urlGroup: 'evt-crm.lead.created',
        body: events[0],
        deduplicationId: events[0]?.id,
        failureCallback: 'https://bos.example.in/api/v1/workers/outbox/failed',
      },
      {
        urlGroup: 'evt-pricing.price.changed',
        body: events[1],
        deduplicationId: events[1]?.id,
        failureCallback: 'https://bos.example.in/api/v1/workers/outbox/failed',
      },
    ]);
    expect(results).toEqual(events.map((e) => ({ id: e.id, ok: true })));
    expect(queue.options[0]).toMatchObject({ enableTelemetry: false, devMode: false });
  });

  it('sends a document to print to the render route as its job, with no queue group', async () => {
    const proof: DeliveredEvent = {
      ...event('print.document.requested'),
      entityId: 3,
      aggregateType: 'print_proof',
      payload: {
        documentType: 'company_letterhead_proof',
        documentId: newId(),
        version: 1,
        v: 1,
      },
    };
    queue.batchJSON.mockResolvedValue([{ messageId: 'm1', url: 'u' }]);
    const results = await qstashEventPublisher(config).publish([proof]);
    expect(queue.batchJSON).toHaveBeenCalledWith([
      {
        url: 'https://bos.example.in/api/v1/workers/pdf/render',
        body: {
          eventId: proof.id,
          entityId: 3,
          target: {
            kind: 'document',
            documentType: 'company_letterhead_proof',
            documentId: proof.payload.documentId,
            version: 1,
          },
        },
        deduplicationId: proof.id,
        failureCallback: 'https://bos.example.in/api/v1/workers/outbox/failed',
      },
    ]);
    expect(queue.addEndpoints).not.toHaveBeenCalled();
    expect(results).toEqual([{ id: proof.id, ok: true }]);
  });

  it('sends each notifying event to the notify route as itself, with no queue group', async () => {
    const types = [
      'crm.opportunity.assigned',
      'crm.duplicate.found',
      'crm.enquiry.routed',
      'sales.order.credit_held',
    ] as const;
    const events = types.map((type) => event(type));
    queue.batchJSON.mockResolvedValue(events.map(() => ({ messageId: 'm', url: 'u' })));
    await qstashEventPublisher(config).publish(events);
    expect(queue.batchJSON).toHaveBeenCalledWith(
      events.map((e) => ({
        url: 'https://bos.example.in/api/v1/workers/notify',
        body: e,
        deduplicationId: e.id,
        failureCallback: 'https://bos.example.in/api/v1/workers/outbox/failed',
      })),
    );
    expect(queue.addEndpoints).not.toHaveBeenCalled();
  });

  it('fails an event the queue refused or did not answer for', async () => {
    const events = [event(), event(), event()];
    queue.batchJSON.mockResolvedValue([{ error: 'url group not found' }, []]);
    const results = await qstashEventPublisher(config).publish(events);
    expect(results.map((r) => r.ok)).toEqual([false, false, false]);
    expect(results[0]).toMatchObject({ error: 'queue_refused' });
  });

  it('makes sure of each type’s queue group once per process, before its first event', async () => {
    queue.batchJSON.mockImplementation((messages) =>
      Promise.resolve(messages.map(() => [{ messageId: 'm', url: 'u' }])),
    );
    const publisher = qstashEventPublisher(config);
    await publisher.publish([event(), event(), event('files.file.uploaded')]);
    expect(queue.addEndpoints.mock.calls.map((c) => c[0])).toEqual([
      {
        name: 'evt-crm.lead.created',
        endpoints: [
          { name: 'bos', url: 'https://bos.example.in/api/v1/workers/outbox/crm.lead.created' },
        ],
      },
      {
        name: 'evt-files.file.uploaded',
        endpoints: [
          { name: 'bos', url: 'https://bos.example.in/api/v1/workers/outbox/files.file.uploaded' },
        ],
      },
    ]);
    expect(queue.addEndpoints.mock.invocationCallOrder[1]).toBeLessThan(
      queue.batchJSON.mock.invocationCallOrder[0] ?? 0,
    );
    await qstashEventPublisher(config).publish([event('files.file.uploaded'), event()]);
    expect(queue.addEndpoints).toHaveBeenCalledTimes(2);
  });

  it('sends the batch when a group cannot be made sure of, and asks again on the next run', async () => {
    queue.addEndpoints.mockRejectedValueOnce(new Error('queue unreachable'));
    queue.batchJSON.mockResolvedValue([{ error: 'url group not found' }]);
    const first = await qstashEventPublisher(config).publish([event('files.file.uploaded')]);
    expect(first[0]).toMatchObject({ ok: false, error: 'queue_refused' });
    queue.batchJSON.mockResolvedValue([[{ messageId: 'm', url: 'u' }]]);
    const second = await qstashEventPublisher(config).publish([event('files.file.uploaded')]);
    expect(second[0]).toMatchObject({ ok: true });
    expect(queue.addEndpoints).toHaveBeenCalledTimes(2);
  });

  it('sends nothing for an empty run', async () => {
    expect(await qstashEventPublisher(config).publish([])).toEqual([]);
    expect(queue.batchJSON).not.toHaveBeenCalled();
    expect(queue.addEndpoints).not.toHaveBeenCalled();
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

  it('asks QStash to call the import worker once per run of a job', async () => {
    queue.publishJSON.mockResolvedValue({ messageId: 'm' });
    const body = { jobId: newId(), entityId: 1, userId: newId() };
    await publishImportCommit(config, body, 'import-run-1');
    expect(queue.publishJSON).toHaveBeenCalledWith({
      url: 'https://bos.example.in/api/v1/workers/imports/commit',
      body,
      retries: 3,
      deduplicationId: 'import-run-1',
    });
  });

  it('refuses a missing or failing signature without throwing', async () => {
    expect(await verifyQStashSignature(config, null, '{}')).toBe(false);
    expect(await verifyQStashSignature(config, '', '{}')).toBe(false);
    expect(await verifyQStashSignature(config, 'a.b.c', '{}')).toBe(false);
  });
});
