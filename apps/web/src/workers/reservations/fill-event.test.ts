import { newId, type DeliveredEvent } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { freedItemsOf } from './fill-event';

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
