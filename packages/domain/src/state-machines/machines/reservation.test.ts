import { DomainError } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { transition, type Actor } from '../define-machine';
import { holding, platform } from '../test-support';
import { reservationMachine, type ReservationEvent, type ReservationRecord } from './reservation';

const NOW = new Date('2026-11-27T06:30:00.000Z');
const active: ReservationRecord = { state: 'active', extendedAt: null };

function fire(
  record: ReservationRecord,
  event: ReservationEvent,
  actor: Actor,
  extra: { reason?: string; requirement?: 'stock' | 'order' } = {},
) {
  return transition(reservationMachine, record, event, {
    actor,
    now: NOW,
    params: { reason: extra.reason ?? null },
    ...(extra.requirement === undefined
      ? {}
      : {
          requirement:
            extra.requirement === 'stock'
              ? { permission: 'inventory.stock.adjust', minScope: 'entity' }
              : { permission: 'sales.order.cancel', minScope: 'entity' },
        }),
  });
}

function reasonOf(run: () => unknown): unknown {
  try {
    run();
  } catch (e) {
    return e instanceof DomainError ? (e.details?.reason ?? e.code) : e;
  }
  return undefined;
}

const manager = holding([{ key: 'inventory.stock.adjust', scope: 'entity' }]);
const gm = holding([{ key: 'sales.order.cancel', scope: 'entity' }]);
const caller = holding([{ key: 'sales.order.confirm', scope: 'own' }]);

describe('the reservation machine', () => {
  it('extends once, with a reason, by the grant the input names', () => {
    expect(
      fire(active, 'extend', manager, { reason: 'Site not ready', requirement: 'stock' }).to,
    ).toBe('active');
    expect(fire(active, 'extend', gm, { reason: 'Payment due', requirement: 'order' }).to).toBe(
      'active',
    );
    expect(
      reasonOf(() =>
        fire({ ...active, extendedAt: NOW }, 'extend', manager, {
          reason: 'Again',
          requirement: 'stock',
        }),
      ),
    ).toBe('reservation_already_extended');
    expect(reasonOf(() => fire(active, 'extend', manager, { requirement: 'stock' }))).toBe(
      'transition_reason_missing',
    );
    // The grant the input names is checked again; with none named the event is refused.
    expect(reasonOf(() => fire(active, 'extend', gm, { reason: 'x', requirement: 'stock' }))).toBe(
      'forbidden',
    );
    expect(reasonOf(() => fire(active, 'extend', manager, { reason: 'x' }))).toBe('forbidden');
  });

  it('is reserved by a person confirming an order, filled and lapsed only by the platform', () => {
    expect(fire({ state: null, extendedAt: null }, 'reserve', caller).to).toBe('active');
    expect(fire({ state: null, extendedAt: null }, 'fill', platform).to).toBe('active');
    expect(reasonOf(() => fire({ state: null, extendedAt: null }, 'fill', manager))).toBe(
      'forbidden',
    );
    expect(fire(active, 'lapse', platform).to).toBe('lapsed');
    expect(reasonOf(() => fire(active, 'lapse', manager))).toBe('forbidden');
  });

  it('is released by hand or with its order, with a reason, and moved, only while active', () => {
    expect(fire(active, 'release', manager, { reason: 'Needed elsewhere' }).to).toBe('released');
    expect(reasonOf(() => fire(active, 'release', manager))).toBe('transition_reason_missing');
    expect(reasonOf(() => fire(active, 'release', gm, { reason: 'x' }))).toBe('forbidden');
    expect(fire(active, 'order_cancel', gm, { reason: 'Order cancelled' }).to).toBe('released');
    expect(fire(active, 'move', manager).to).toBe('released');
    for (const state of ['released', 'lapsed', 'picked'] as const) {
      expect(
        reasonOf(() => fire({ state, extendedAt: null }, 'release', manager, { reason: 'x' })),
      ).toBe('reservation_transition_not_allowed');
    }
  });
});
