import { newId, type DeliveredEvent } from '@shakti/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { EventHandlerContext } from '../events/registry';

// The fill runs one item a transaction (finding 1 of the H2 review): the command is stood in, so
// only what the worker asks of it is checked here; the definer's locks are proved in
// packages/domain (reservations-concurrency.test.ts).
const domain = vi.hoisted(() => ({ executeCommand: vi.fn() }));
vi.mock('@shakti/domain', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  executeCommand: domain.executeCommand,
}));

const { freedItemsOf, handleFillEvent } = await import('./fill-event');

const A = newId();
const B = newId();

function event(type: DeliveredEvent['type'], payload: Record<string, unknown>): DeliveredEvent {
  return {
    id: newId(),
    sequence: '1',
    type,
    entityId: 1,
    aggregateType: 'reservation',
    aggregateId: newId(),
    payload: { ...payload, v: 1 },
  };
}

describe('the items an event sends to the backorder fill', () => {
  it('are those stock moved into a bin, once each, never one only taken out', () => {
    const moved = event('inventory.stock.moved', {
      count: 3,
      movements: [
        {
          movementId: newId(),
          itemId: A,
          fromBinId: null,
          toBinId: newId(),
          qty: '1.000',
          reason: 'adjust_gain',
        },
        {
          movementId: newId(),
          itemId: A,
          fromBinId: newId(),
          toBinId: newId(),
          qty: '1.000',
          reason: 'transfer',
        },
        {
          movementId: newId(),
          itemId: B,
          fromBinId: newId(),
          toBinId: null,
          qty: '1.000',
          reason: 'adjust_loss',
        },
      ],
    });
    expect(freedItemsOf(moved)).toEqual([A]);
  });

  it('are the item of a hold that ended', () => {
    expect(
      freedItemsOf(
        event('inventory.reservation.released', {
          reservationId: newId(),
          salesOrderId: newId(),
          itemId: A,
        }),
      ),
    ).toEqual([A]);
    expect(
      freedItemsOf(
        event('inventory.reservation.moved', {
          reservationId: newId(),
          salesOrderId: newId(),
          itemId: B,
          hubId: newId(),
          reservationIds: [newId()],
        }),
      ),
    ).toEqual([B]);
    expect(
      freedItemsOf(
        event('inventory.reservation.lapsed', {
          salesOrderId: newId(),
          reservationIds: [newId(), newId()],
          itemIds: [A, B, A],
        }),
      ),
    ).toEqual([A, B]);
  });

  it('are none for any other event', () => {
    expect(freedItemsOf(event('sales.order.confirmed', { accountId: newId() }))).toEqual([]);
  });
});

describe('handleFillEvent', () => {
  const ctx = {
    principal: { id: 'p', kind: 'system', entityIds: [1], permissions: [] },
    requestId: 'r',
  } as unknown as EventHandlerContext;

  it('fills each item in a transaction of its own, never two items in one', async () => {
    domain.executeCommand.mockReset();
    domain.executeCommand.mockResolvedValueOnce({ entityId: 1, filled: 2 });
    domain.executeCommand.mockResolvedValueOnce({ entityId: 1, filled: 1 });
    const out = await handleFillEvent(
      event('inventory.reservation.lapsed', {
        salesOrderId: newId(),
        reservationIds: [newId()],
        itemIds: [A, B],
      }),
      ctx,
    );
    expect(out).toEqual({ entityId: 1, filled: 3 });
    expect(domain.executeCommand).toHaveBeenCalledTimes(2);
    expect(domain.executeCommand.mock.calls.map((call: unknown[]) => call[3])).toEqual([
      { entityId: 1, itemId: A },
      { entityId: 1, itemId: B },
    ]);
  });

  it('runs nothing for an event that freed no stock', async () => {
    domain.executeCommand.mockReset();
    expect(
      await handleFillEvent(event('sales.order.confirmed', { accountId: newId() }), ctx),
    ).toBeUndefined();
    expect(domain.executeCommand).not.toHaveBeenCalled();
  });
});
