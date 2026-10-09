import { describe, expect, it } from 'vitest';
import { newId } from '../ids';
import {
  DeliveredEvent,
  EVENT_TYPES,
  EVENT_VERSION,
  isEventType,
  isSubscribed,
  parseEventPayload,
} from './catalogue';

describe('the event catalogue', () => {
  it('names every type <aggregate>.<verb_past> in snake case', () => {
    for (const type of EVENT_TYPES) expect(type).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
  });

  it('adds the version to a payload that fits its type', () => {
    const parsed = parseEventPayload('crm.lead.created', {
      pipelineKey: 'pump',
      sourceCode: null,
      existingAccount: false,
    });
    expect(parsed).toEqual({
      ok: true,
      payload: { pipelineKey: 'pump', sourceCode: null, existingAccount: false, v: EVENT_VERSION },
    });
  });

  it('refuses a type that is not in the catalogue', () => {
    expect(parseEventPayload('crm.lead.vanished', {})).toMatchObject({
      ok: false,
      problem: 'unknown_type',
    });
    expect(isEventType('toString')).toBe(false);
  });

  it('refuses extra keys, so no free text or contact detail slips into an event', () => {
    const parsed = parseEventPayload('admin.user.suspended', {
      revokedSessions: 2,
      reason: 'left the company',
    });
    expect(parsed).toMatchObject({ ok: false, problem: 'bad_payload' });
  });

  it('refuses a payload missing a field', () => {
    expect(parseEventPayload('pricing.price.changed', { newPrice: '10.00' })).toMatchObject({
      ok: false,
      problem: 'bad_payload',
    });
  });

  it('subscribes only the types a worker handles (apps/web/src/workers/events/registry.ts)', () => {
    expect(EVENT_TYPES.filter(isSubscribed).sort()).toEqual(
      [
        'crm.duplicate.found',
        'crm.enquiry.routed',
        'crm.opportunity.assigned',
        'crm.opportunity.stage_moved',
        'files.file.uploaded',
        'knowledge.file.index_requested',
        'platform.probe.requested',
        'print.document.requested',
        'sales.order.credit_held',
      ].sort(),
    );
    expect(isSubscribed('crm.lead.vanished')).toBe(false);
  });

  it('carries the delivery check as a moment and nothing else', () => {
    const requestedAt = '2026-09-29T10:00:00.000Z';
    expect(parseEventPayload('platform.probe.requested', { requestedAt })).toEqual({
      ok: true,
      payload: { requestedAt, v: EVENT_VERSION },
    });
    expect(
      parseEventPayload('platform.probe.requested', { requestedAt: 'yesterday' }),
    ).toMatchObject({ ok: false, problem: 'bad_payload' });
  });

  it('describes the delivered message, version included', () => {
    const message = {
      id: newId(),
      sequence: '42',
      type: 'admin.user.reactivated',
      entityId: 1,
      aggregateType: 'user',
      aggregateId: newId(),
      payload: { v: EVENT_VERSION },
    };
    expect(DeliveredEvent.parse(message)).toEqual(message);
    expect(DeliveredEvent.safeParse({ ...message, payload: {} }).success).toBe(false);
    expect(DeliveredEvent.safeParse({ ...message, extra: 1 }).success).toBe(false);
  });
});
