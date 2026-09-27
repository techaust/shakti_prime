import { describe, expect, it } from 'vitest';
import {
  DeadLetteredEvent,
  IntegrationHealthQuery,
  IntegrationReplayResponse,
} from './admin-integrations';
import { API_FIXTURES, IDS } from './fixtures';

describe('the Integration Health contracts (docs/API.md §3.7)', () => {
  const health = API_FIXTURES['admin.integrations'].response as {
    deadLetters: { items: Record<string, unknown>[] };
  };
  const deadLetter = health.deadLetters.items[0] ?? {};

  it('shows a dead letter by ids, counts and times, never its stored error', () => {
    expect(DeadLetteredEvent.safeParse(deadLetter).success).toBe(true);
    expect(
      DeadLetteredEvent.safeParse({ ...deadLetter, lastError: 'queue group refused' }).success,
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
