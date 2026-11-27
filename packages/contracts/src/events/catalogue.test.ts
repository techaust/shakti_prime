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
        // The Caller Co-pilot's brief on demand and the summary of an ended dial (A2).
        'agents.brief.requested',
        'calls.dial.completed',
        'calls.missed.recorded',
        'crm.duplicate.found',
        'crm.enquiry.routed',
        // An enquiry that joined a nurtured lead, told to its owner (p2-fixes).
        'crm.lead.attached',
        'crm.lead.created',
        // J2: a loan turned down, told to the owner of the order's lead or customer.
        'crm.loan.rejected',
        'crm.opportunity.assigned',
        'crm.opportunity.stage_moved',
        'files.file.uploaded',
        'knowledge.file.index_requested',
        'knowledge.playbook.changed',
        'messaging.button.pressed',
        'messaging.message.requested',
        // The WhatsApp Concierge on each customer message (A3).
        'messaging.message.received',
        'platform.probe.requested',
        'print.document.requested',
        // A sheet of QR labels (Q1).
        'print.labels.requested',
        'sales.order.confirmed',
        'sales.order.credit_held',
        'sales.quote.accepted',
        'sales.quote.sent',
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
