import {
  DomainError,
  EVENT_TYPES,
  isSubscribed,
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DeliveredEvent,
} from '@shakti/contracts';
import { memoryKeyValue, type KeyValue } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  deliverEvent,
  EVENT_CLAIM_SECONDS,
  EVENT_ID_TTL_SECONDS,
  eventKey,
  sequenceKey,
} from './deliver';
import { readDeliveryCheck, recordProbeArrival, rememberProbe } from './probe';
import { EVENT_WORKERS, workerFor, type EventHandler, type EventWorker } from './registry';

let sequence = 100;
function probeEvent(overrides: Partial<DeliveredEvent> = {}): DeliveredEvent {
  sequence += 1;
  return {
    id: newId(),
    sequence: String(sequence),
    type: 'platform.probe.requested',
    entityId: 2,
    aggregateType: 'delivery_probe',
    aggregateId: newId(),
    payload: { v: 1, requestedAt: '2026-09-29T10:00:00.000Z' },
    ...overrides,
  };
}

/** A worker that records its runs, with the given ordering and outcome. */
function counting(
  ordering: EventWorker['ordering'] = 'every',
  outcome: () => Promise<void> = () => Promise.resolve(),
) {
  const runs: string[] = [];
  const worker: EventWorker = {
    ordering,
    handle: (event) => {
      runs.push(event.id);
      return outcome();
    },
  };
  return { worker, runs };
}

const deliver = (event: DeliveredEvent, keyValue: KeyValue, worker: EventWorker) =>
  deliverEvent(event, { keyValue, requestId: 'r', worker });

/** A promise the test settles when it chooses, to hold a worker mid-run. */
function gate() {
  let open: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { held, open: () => open() };
}

describe('the worker registry and the event catalogue', () => {
  it('agree: a type is subscribed exactly when a worker handles it', () => {
    expect(EVENT_TYPES.filter(isSubscribed).sort()).toEqual(Object.keys(EVENT_WORKERS).sort());
  });

  it('knows no worker for a type outside the catalogue or one nobody handles', () => {
    expect(workerFor('crm.lead.vanished')).toBeUndefined();
    expect(workerFor('crm.lead.created')).toBeUndefined();
    expect(workerFor('toString')).toBeUndefined();
    expect(workerFor('platform.probe.requested')?.ordering ?? 'every').toBe('every');
  });
});

describe('deliverEvent', () => {
  it('runs the worker as system:workers in the event company, then records the id as handled', async () => {
    const keyValue = memoryKeyValue();
    const handle = vi.fn<EventHandler>(() => Promise.resolve());
    const event = probeEvent();
    const result = await deliverEvent(event, { keyValue, requestId: 'r-1', worker: { handle } });
    expect(result).toEqual({ eventId: event.id, outcome: 'done' });
    const [, ctx] = handle.mock.calls[0] ?? [];
    expect(ctx?.principal).toEqual({
      id: SYSTEM_WORKERS_PRINCIPAL_ID,
      kind: 'system',
      roleKey: 'system:workers',
      entityIds: [2],
      permissions: [],
    });
    expect(ctx?.requestId).toBe('r-1');
    expect(await keyValue.get(eventKey(event.id))).toBe('done');
    // An `every` worker keeps no sequence.
    expect(await keyValue.get(sequenceKey(event))).toBeNull();
  });

  it('keeps the handled id for seven days', async () => {
    let now = 0;
    const keyValue = memoryKeyValue(() => now);
    const event = probeEvent();
    await deliver(event, keyValue, counting().worker);
    now = (EVENT_ID_TTL_SECONDS - 1) * 1000;
    expect(await keyValue.get(eventKey(event.id))).toBe('done');
    now = EVENT_ID_TTL_SECONDS * 1000;
    expect(await keyValue.get(eventKey(event.id))).toBeNull();
    expect(EVENT_ID_TTL_SECONDS).toBe(604_800);
  });

  it('answers duplicate for an id already handled and runs nothing', async () => {
    const keyValue = memoryKeyValue();
    const { worker, runs } = counting();
    const event = probeEvent();
    await deliver(event, keyValue, worker);
    expect(await deliver(event, keyValue, worker)).toEqual({
      eventId: event.id,
      outcome: 'duplicate',
    });
    expect(runs).toHaveLength(1);
  });

  it('runs the workers of two types on one aggregate, whatever their sequence', async () => {
    const keyValue = memoryKeyValue();
    const aggregateId = newId();
    const first = counting('latest-only');
    const second = counting('latest-only');
    const newer = probeEvent({ aggregateId, sequence: '900' });
    const older = probeEvent({ aggregateId, sequence: '800', type: 'crm.lead.created' });
    expect((await deliver(newer, keyValue, first.worker)).outcome).toBe('done');
    expect((await deliver(older, keyValue, second.worker)).outcome).toBe('done');
    expect([first.runs, second.runs]).toEqual([[newer.id], [older.id]]);
  });

  it('an every worker runs a failed older event retry after a newer one succeeded', async () => {
    const keyValue = memoryKeyValue();
    const aggregateId = newId();
    let fail = true;
    const { worker, runs } = counting('every', () =>
      fail ? Promise.reject(new DomainError('integration_unavailable')) : Promise.resolve(),
    );
    const older = probeEvent({ aggregateId, sequence: '500' });
    const newer = probeEvent({ aggregateId, sequence: '501' });
    await expect(deliver(older, keyValue, worker)).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
    fail = false;
    expect((await deliver(newer, keyValue, worker)).outcome).toBe('done');
    expect((await deliver(older, keyValue, worker)).outcome).toBe('done');
    expect(runs).toEqual([older.id, newer.id, older.id]);
  });

  it('a latest-only worker skips an event no newer than the last it handled, and records it', async () => {
    const keyValue = memoryKeyValue();
    const aggregateId = newId();
    const { worker, runs } = counting('latest-only');
    const older = probeEvent({ aggregateId, sequence: '9' });
    const newer = probeEvent({ aggregateId, sequence: '10' });
    await deliver(newer, keyValue, worker);
    expect(await deliver(older, keyValue, worker)).toEqual({
      eventId: older.id,
      outcome: 'duplicate',
    });
    expect(runs).toEqual([newer.id]);
    expect(await keyValue.get(eventKey(older.id))).toBe('done');
    expect(await keyValue.get(sequenceKey(newer))).toBe('10');
    expect(sequenceKey(newer)).toBe(`seq:platform.probe.requested:delivery_probe:${aggregateId}`);
  });

  it('answers a retryable conflict while another delivery holds the event, not duplicate', async () => {
    const keyValue = memoryKeyValue();
    const { held, open } = gate();
    const { worker, runs } = counting('every', () => held);
    const event = probeEvent();
    const first = deliver(event, keyValue, worker);
    await expect(deliver(event, keyValue, worker)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'event_in_progress' },
    });
    open();
    expect((await first).outcome).toBe('done');
    expect(runs).toEqual([event.id]);
    expect((await deliver(event, keyValue, worker)).outcome).toBe('duplicate');
  });

  it('lets a claim left by a delivery that died lapse, so the event runs again', async () => {
    let now = 0;
    const keyValue = memoryKeyValue(() => now);
    const event = probeEvent();
    await keyValue.setIfAbsent(eventKey(event.id), 'claimed', EVENT_CLAIM_SECONDS);
    const { worker, runs } = counting();
    await expect(deliver(event, keyValue, worker)).rejects.toMatchObject({ code: 'conflict' });
    now = EVENT_CLAIM_SECONDS * 1000;
    expect((await deliver(event, keyValue, worker)).outcome).toBe('done');
    expect(runs).toEqual([event.id]);
  });

  it('never lowers a latest-only sequence when an older delivery finishes last', async () => {
    const keyValue = memoryKeyValue();
    const aggregateId = newId();
    const { held, open } = gate();
    const older = probeEvent({ aggregateId, sequence: '41' });
    const newer = probeEvent({ aggregateId, sequence: '42' });
    const worker: EventWorker = {
      ordering: 'latest-only',
      handle: (event) => (event.id === older.id ? held : Promise.resolve()),
    };
    // Both pass the sequence check before either finishes; the newer one finishes first.
    const olderRun = deliver(older, keyValue, worker);
    await deliver(newer, keyValue, worker);
    open();
    await olderRun;
    expect(await keyValue.get(sequenceKey(newer))).toBe('42');
  });

  it('refuses a type no worker handles as not_found', async () => {
    const event = probeEvent({ type: 'crm.lead.created' });
    await expect(
      deliverEvent(event, { keyValue: memoryKeyValue(), requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('passes a worker refusal through and keeps nothing, so it is delivered again', async () => {
    const keyValue = memoryKeyValue();
    const event = probeEvent();
    const busy = counting('every', () =>
      Promise.reject(new DomainError('integration_unavailable', 'the service is away')),
    );
    await expect(deliver(event, keyValue, busy.worker)).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
    expect(await keyValue.get(eventKey(event.id))).toBeNull();
    expect((await deliver(event, keyValue, counting().worker)).outcome).toBe('done');
  });

  it('turns anything else a worker throws into internal', async () => {
    const broken = counting('every', () => Promise.reject(new TypeError('x is undefined')));
    await expect(deliver(probeEvent(), memoryKeyValue(), broken.worker)).rejects.toMatchObject({
      code: 'internal',
    });
  });

  it('answers integration_unavailable when the store cannot claim or record', async () => {
    const down = (): Promise<never> => Promise.reject(new Error('store down'));
    const failingClaim: KeyValue = { ...memoryKeyValue(), setIfAbsent: down };
    await expect(deliver(probeEvent(), failingClaim, counting().worker)).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
    const failingRecord: KeyValue = { ...memoryKeyValue(), set: down };
    await expect(deliver(probeEvent(), failingRecord, counting().worker)).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
  });
});

describe('the delivery check', () => {
  it('records the arrival and answers the milliseconds from the command to the worker', async () => {
    const keyValue = memoryKeyValue();
    const event = probeEvent();
    const requestedAt = '2026-09-29T10:00:00.000Z';
    await rememberProbe(keyValue, { probeId: event.aggregateId, requestedAt });
    expect(await readDeliveryCheck(keyValue, new Date('2026-09-29T10:00:01.000Z'))).toMatchObject({
      state: 'waiting',
      milliseconds: null,
    });
    await recordProbeArrival(event, keyValue, new Date('2026-09-29T10:00:00.842Z'));
    expect(await readDeliveryCheck(keyValue, new Date())).toEqual({
      probeId: event.aggregateId,
      state: 'arrived',
      requestedAt,
      arrivedAt: '2026-09-29T10:00:00.842Z',
      milliseconds: 842,
    });
  });

  it('calls a check lost after ten minutes without an arrival', async () => {
    const keyValue = memoryKeyValue();
    const probe = { probeId: newId(), requestedAt: '2026-09-29T10:00:00.000Z' };
    const at = (iso: string) => readDeliveryCheck(keyValue, new Date(iso), probe);
    expect((await at('2026-09-29T10:09:59.000Z'))?.state).toBe('waiting');
    expect((await at('2026-09-29T10:10:00.001Z'))?.state).toBe('lost');
  });

  it('answers nothing when no check was run or the store holds something unreadable', async () => {
    const keyValue = memoryKeyValue();
    expect(await readDeliveryCheck(keyValue, new Date())).toBeUndefined();
    await keyValue.set('probe:last', 'not json', 60);
    expect(await readDeliveryCheck(keyValue, new Date())).toBeUndefined();
    await keyValue.set('probe:last', JSON.stringify({ probeId: newId(), requestedAt: 'soon' }), 60);
    expect(await readDeliveryCheck(keyValue, new Date())).toBeUndefined();
  });

  it('refuses a delivery check event without its moment', async () => {
    await expect(
      recordProbeArrival(probeEvent({ payload: { v: 1 } }), memoryKeyValue(), new Date()),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
