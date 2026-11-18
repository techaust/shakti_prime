import type { DeliveredEvent } from '@shakti/contracts';
import { memoryKeyValue } from '@shakti/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventHandlerContext } from '../events/registry';

// The Concierge's worker (A3, design §7.2): a message the platform answers itself is never the
// Concierge's, and any other runs the Concierge once, bound to the event's chat and keyed by it.

const domain = vi.hoisted(() => ({ runConcierge: vi.fn() }));
vi.mock('@shakti/domain', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  runConcierge: domain.runConcierge,
}));

const { handleConciergeEvent } = await import('./concierge-event');

const THREAD = '01990000-0000-7000-8000-00000000e001';
const MESSAGE = '01990000-0000-7000-8000-00000000e002';

function event(payload: Record<string, unknown>): DeliveredEvent {
  return {
    id: '01990000-0000-7000-8000-00000000e003',
    sequence: '7',
    type: 'messaging.message.received',
    entityId: 2,
    aggregateType: 'whatsapp_thread',
    aggregateId: THREAD,
    payload: { v: 1, ...payload },
  };
}

const ctx = {
  principal: { id: 'p', kind: 'system', entityIds: [2], permissions: [] },
  keyValue: memoryKeyValue(),
  requestId: 'r',
  now: new Date(),
  startedAt: performance.now(),
} as unknown as EventHandlerContext;

const deps = {} as never;

beforeEach(() => {
  domain.runConcierge.mockReset();
  domain.runConcierge.mockResolvedValue({ outcome: 'ran', runs: {} });
});

describe('handleConciergeEvent', () => {
  it('leaves a message the platform answers (STATUS, a quote’s code) alone', async () => {
    const message = { messageId: MESSAGE, kind: 'text', accountId: null, firstMessage: false };
    expect(await handleConciergeEvent(event({ ...message, platform: true }), ctx, deps)).toBeNull();
    expect(domain.runConcierge).not.toHaveBeenCalled();
  });

  it('runs the Concierge once on any other message, bound to its chat and keyed by the event', async () => {
    const message = { messageId: MESSAGE, kind: 'text', accountId: null, firstMessage: true };
    await handleConciergeEvent(event({ ...message, platform: false }), ctx, deps);
    expect(domain.runConcierge).toHaveBeenCalledWith(
      {
        eventId: '01990000-0000-7000-8000-00000000e003',
        entityId: 2,
        threadId: THREAD,
        messageId: MESSAGE,
      },
      deps,
    );
  });

  it('reads an event written before the platform mark as the Concierge’s', async () => {
    await handleConciergeEvent(event({ messageId: MESSAGE, kind: 'media' }), ctx, deps);
    expect(domain.runConcierge).toHaveBeenCalledTimes(1);
  });

  it('ignores an event without a message id', async () => {
    expect(await handleConciergeEvent(event({ messageId: 'nope' }), ctx, deps)).toBeNull();
    expect(domain.runConcierge).not.toHaveBeenCalled();
  });
});
