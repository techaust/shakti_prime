import { describe, expect, it } from 'vitest';
import {
  DeadLetteredEvent,
  DeliveryCheck,
  IntegrationHealthResponse,
  IntegrationHealthQuery,
  IntegrationReplayResponse,
} from './admin-integrations';
import { API_FIXTURES, IDS } from './fixtures';

describe('the Integration Health contracts (docs/06-api.md §3.7)', () => {
  const health = API_FIXTURES['admin.integrations'].response as {
    deadLetters: { items: Record<string, unknown>[] };
  };
  const deadLetter = health.deadLetters.items[0] ?? {};

  it('shows a dead letter by ids, counts, times and an error code, never error text', () => {
    expect(DeadLetteredEvent.safeParse(deadLetter).success).toBe(true);
    expect(
      DeadLetteredEvent.safeParse({ ...deadLetter, lastError: 'queue group refused' }).success,
    ).toBe(false);
    for (const errorCode of ['queue_refused', 'no_outcome', 'TimeoutError', null]) {
      expect(DeadLetteredEvent.safeParse({ ...deadLetter, errorCode }).success).toBe(true);
    }
    for (const errorCode of ['http_503 upstream said no', 'rekha@example.com', '', '9876543210']) {
      expect(DeadLetteredEvent.safeParse({ ...deadLetter, errorCode }).success).toBe(false);
    }
  });

  it('answers the outbox by type, the last run and the delivery check', () => {
    expect(
      IntegrationHealthResponse.safeParse(API_FIXTURES['admin.integrations'].response).success,
    ).toBe(true);
    const check = { probeId: IDS.probe, requestedAt: '2026-09-27T05:05:12.000Z' };
    expect(
      DeliveryCheck.safeParse({ ...check, state: 'waiting', arrivedAt: null, milliseconds: null })
        .success,
    ).toBe(true);
    expect(
      DeliveryCheck.safeParse({ ...check, state: 'arrived', arrivedAt: null, milliseconds: -1 })
        .success,
    ).toBe(false);
  });

  it('lists a dead letter whose type left the catalogue', () => {
    expect(DeadLetteredEvent.safeParse({ ...deadLetter, type: 'crm.lead.retired' }).success).toBe(
      true,
    );
  });

  it('pages the dead letters 1 to 200 at a time, 50 by default', () => {
    expect(IntegrationHealthQuery.parse({}).limit).toBe(50);
    expect(IntegrationHealthQuery.safeParse({ limit: '201' }).success).toBe(false);
  });

  it('answers a replay with the attempts reset', () => {
    expect(
      IntegrationReplayResponse.safeParse({ eventId: IDS.event, requeued: true, attempts: 3 })
        .success,
    ).toBe(false);
  });
});
