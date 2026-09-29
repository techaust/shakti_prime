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
import { deliverEvent, EVENT_ID_TTL_SECONDS, eventKey, sequenceKey } from './deliver';
import { readDeliveryCheck, recordProbeArrival, rememberProbe } from './probe';
import { EVENT_HANDLERS, handlerFor, type EventHandler } from './registry';

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

const ok: EventHandler = () => Promise.resolve();

describe('the handler registry and the event catalogue', () => {
  it('agree: a type is subscribed exactly when a worker handles it', () => {
    expect(EVENT_TYPES.filter(isSubscribed).sort()).toEqual(Object.keys(EVENT_HANDLERS).sort());
  });

  it('knows no handler for a type outside the catalogue or one nobody handles', () => {
    expect(handlerFor('crm.lead.vanished')).toBeUndefined();
    expect(handlerFor('crm.lead.created')).toBeUndefined();
    expect(handlerFor('toString')).toBeUndefined();
    expect(handlerFor('platform.probe.requested')).toBeDefined();
  });
});

describe('deliverEvent', () => {
  it('runs the handler as system:workers in the event’s company, then records the id', async () => {
    const keyValue = memoryKeyValue();
    const handler = vi.fn<EventHandler>(() => Promise.resolve());
    const event = probeEvent();
    const result = await deliverEvent(event, { keyValue, requestId: 'r-1', handler });
    expect(result).toEqual({ eventId: event.id, outcome: 'done' });
    const [, ctx] = handler.mock.calls[0] ?? [];
    expect(ctx?.principal).toEqual({
      id: SYSTEM_WORKERS_PRINCIPAL_ID,
      kind: 'system',
      roleKey: 'system:workers',
      entityIds: [2],
      permissions: [],
    });
    expect(ctx?.requestId).toBe('r-1');
    expect(await keyValue.get(eventKey(event.id))).toBe('1');
    expect(await keyValue.get(sequenceKey(event))).toBe(event.sequence);
  });

  it('keeps the id for seven days', async () => {
    let now = 0;
    const keyValue = memoryKeyValue(() => now);
    const event = probeEvent();
    await deliverEvent(event, { keyValue, requestId: 'r', handler: ok });
    now = (EVENT_ID_TTL_SECONDS - 1) * 1000;
    expect(await keyValue.get(eventKey(event.id))).toBe('1');
    now = EVENT_ID_TTL_SECONDS * 1000;
    expect(await keyValue.get(eventKey(event.id))).toBeNull();
    expect(EVENT_ID_TTL_SECONDS).toBe(604_800);
  });

  it('answers duplicate for an id already handled and runs nothing', async () => {
    const keyValue = memoryKeyValue();
    const handler = vi.fn<EventHandler>(() => Promise.resolve());
    const event = probeEvent();
    await deliverEvent(event, { keyValue, requestId: 'r', handler });
    const again = await deliverEvent(event, { keyValue, requestId: 'r', handler });
    expect(again).toEqual({ eventId: event.id, outcome: 'duplicate' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('answers duplicate for an event older than the newest handled for its aggregate', async () => {
    const keyValue = memoryKeyValue();
    const handler = vi.fn<EventHandler>(() => Promise.resolve());
    const aggregateId = newId();
    const older = probeEvent({ aggregateId, sequence: '500' });
    const newer = probeEvent({ aggregateId, sequence: '501' });
    await deliverEvent(newer, { keyValue, requestId: 'r', handler });
    const late = await deliverEvent(older, { keyValue, requestId: 'r', handler });
    expect(late).toEqual({ eventId: older.id, outcome: 'duplicate' });
    expect(handler).toHaveBeenCalledTimes(1);
    // Another aggregate's order is its own.
    const other = probeEvent({ sequence: '400' });
    expect((await deliverEvent(other, { keyValue, requestId: 'r', handler })).outcome).toBe('done');
  });

  it('compares sequences as whole numbers, not as text', async () => {
    const keyValue = memoryKeyValue();
    const aggregateId = newId();
    await deliverEvent(probeEvent({ aggregateId, sequence: '9' }), {
      keyValue,
      requestId: 'r',
      handler: ok,
    });
    const later = probeEvent({ aggregateId, sequence: '10' });
    expect((await deliverEvent(later, { keyValue, requestId: 'r', handler: ok })).outcome).toBe(
      'done',
    );
  });

  it('refuses a type no worker handles as not_found', async () => {
    const event = probeEvent({ type: 'crm.lead.created' });
    await expect(
      deliverEvent(event, { keyValue: memoryKeyValue(), requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('passes a handler’s own refusal through and records nothing, so it is delivered again', async () => {
    const keyValue = memoryKeyValue();
    const event = probeEvent();
    const busy: EventHandler = () =>
      Promise.reject(new DomainError('integration_unavailable', 'the service is away'));
    await expect(
      deliverEvent(event, { keyValue, requestId: 'r', handler: busy }),
    ).rejects.toMatchObject({ code: 'integration_unavailable' });
    expect(await keyValue.get(eventKey(event.id))).toBeNull();
    expect(await keyValue.get(sequenceKey(event))).toBeNull();
    expect((await deliverEvent(event, { keyValue, requestId: 'r', handler: ok })).outcome).toBe(
      'done',
    );
  });

  it('turns anything else a handler throws into internal', async () => {
    const broken: EventHandler = () => Promise.reject(new TypeError('x is undefined'));
    await expect(
      deliverEvent(probeEvent(), { keyValue: memoryKeyValue(), requestId: 'r', handler: broken }),
    ).rejects.toMatchObject({ code: 'internal' });
  });

  it('answers integration_unavailable when the store cannot be read or written', async () => {
    const down: KeyValue = {
      get: () => Promise.reject(new Error('store down')),
      set: () => Promise.reject(new Error('store down')),
      del: () => Promise.resolve(),
      incr: () => Promise.resolve(1),
    };
    await expect(
      deliverEvent(probeEvent(), { keyValue: down, requestId: 'r', handler: ok }),
    ).rejects.toMatchObject({ code: 'integration_unavailable' });
    const readable: KeyValue = {
      ...memoryKeyValue(),
      set: () => Promise.reject(new Error('store down')),
    };
    await expect(
      deliverEvent(probeEvent(), { keyValue: readable, requestId: 'r', handler: ok }),
    ).rejects.toMatchObject({ code: 'integration_unavailable' });
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
