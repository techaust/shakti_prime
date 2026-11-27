import {
  DomainError,
  ExtendReservationInput,
  MoveReservationInput,
  ReleaseReservationInput,
  ReservationChangedDto,
  ReservationStateSchema,
  type ExtendAuthority,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand, type Requirement } from '../../command/define-command';
import { transition } from '../../state-machines/define-machine';
import {
  reservationMachine,
  type ReservationRecord,
} from '../../state-machines/machines/reservation';
import { reservationCall } from '../../stock/reserve';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { requireEntity } from '../crm/opportunity-shared';

/**
 * A person's change of one reservation (H2, docs/03-roadmap-appendix/phase3.md §7.1): extended
 * once, released by hand, or moved to another hub. Each reads the reservation as row security
 * shows it (`inventory.stock.read`), fires the `reservation` machine, and changes it through its
 * definer, which locks the order, then the stock in H1's order, and checks the grant again. Audit
 * rows and events carry ids, dates and the person's reason, never a quantity or a cost.
 */

interface ReservationFacts extends ReservationRecord {
  id: string;
  entityId: number;
  salesOrderId: string;
  itemId: string;
  expiresAt: Date;
}

/** The reservation as the caller reads it, in the request's company; `reservation_missing` else. */
async function readReservation(
  ctx: CommandContext,
  entityId: number,
  reservationId: string,
): Promise<ReservationFacts> {
  requireEntity(ctx, entityId);
  const r = schema.reservations;
  const [row] = await ctx.tx
    .select({
      id: r.id,
      entityId: r.entityId,
      salesOrderId: r.salesOrderId,
      itemId: r.itemId,
      state: r.state,
      expiresAt: r.expiresAt,
      extendedAt: r.extendedAt,
    })
    .from(r)
    .where(eq(r.id, reservationId))
    .limit(1);
  if (row?.entityId !== entityId) {
    throw new DomainError('not_found', `reservation ${reservationId} is not visible`, {
      reason: 'reservation_missing',
    });
  }
  return { ...row, state: ReservationStateSchema.parse(row.state) };
}

const EXTEND_BY: Readonly<Record<ExtendAuthority, Requirement>> = {
  stock: { permission: 'inventory.stock.adjust', minScope: 'entity' },
  order: { permission: 'sales.order.cancel', minScope: 'entity' },
};

/**
 * `inventory.reservation.extend`: held one more hold period (`WORKSHOP_DEFAULTS.stock`), once,
 * with a reason; a new reminder is due before the new date. The Inventory Manager extends with
 * `inventory.stock.adjust`, the General Manager with `sales.order.cancel`, named by the input.
 * People only.
 */
export const extendReservation = defineCommand({
  name: 'inventory.reservation.extend',
  permission: {
    keys: ['inventory.stock.adjust', 'sales.order.cancel'],
    of: (input: ExtendReservationInput) => EXTEND_BY[input.authority],
  },
  peopleOnly: true,
  input: ExtendReservationInput,
  output: ReservationChangedDto,
  auditFields: ['expiresAt', 'extendReason'],
  async handler(ctx, input) {
    const res = await readReservation(ctx, input.entityId, input.reservationId);
    transition(reservationMachine, res, 'extend', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: { reason: input.reason },
      requirement: EXTEND_BY[input.authority],
    });
    const [row] = await reservationCall<{ until: Date | string }>(
      ctx.tx,
      sql`select app.reservation_extend(${res.id}::uuid,
                 ${WORKSHOP_DEFAULTS.stock.reservationHoldDays}::integer, ${input.reason}) as until`,
    );
    if (!row) throw new DomainError('internal', 'the extension answered nothing');
    const until = new Date(row.until);
    ctx.audit({
      aggregateType: 'reservation',
      aggregateId: res.id,
      entityId: res.entityId,
      before: { expiresAt: res.expiresAt.toISOString() },
      after: { expiresAt: until.toISOString(), extendReason: input.reason },
    });
    ctx.emit({
      type: 'inventory.reservation.extended',
      entityId: res.entityId,
      aggregateType: 'reservation',
      aggregateId: res.id,
      payload: { reservationId: res.id, salesOrderId: res.salesOrderId },
    });
    return { reservationIds: [res.id], expiresAt: until };
  },
});

/**
 * `inventory.reservation.release`: the stock freed by hand with a reason; the quantity is back on
 * order, behind the backorders already queued. `inventory.stock.adjust`. People only.
 */
export const releaseReservation = defineCommand({
  name: 'inventory.reservation.release',
  permission: 'inventory.stock.adjust',
  minScope: 'entity',
  peopleOnly: true,
  input: ReleaseReservationInput,
  output: ReservationChangedDto,
  auditFields: ['reservationState', 'releaseReason'],
  async handler(ctx, input) {
    const res = await readReservation(ctx, input.entityId, input.reservationId);
    const released = transition(reservationMachine, res, 'release', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: { reason: input.reason },
    });
    await reservationCall(
      ctx.tx,
      sql`select app.reservation_release(${res.id}::uuid, ${input.reason})`,
    );
    ctx.audit({
      aggregateType: 'reservation',
      aggregateId: res.id,
      entityId: res.entityId,
      before: { reservationState: res.state },
      after: { reservationState: released.to, releaseReason: input.reason },
    });
    ctx.emit({
      type: 'inventory.reservation.released',
      entityId: res.entityId,
      aggregateType: 'reservation',
      aggregateId: res.id,
      payload: { reservationId: res.id, salesOrderId: res.salesOrderId, itemId: res.itemId },
    });
    return { reservationIds: [res.id], expiresAt: null };
  },
});

/**
 * `inventory.reservation.move`: the same quantity reserved from another hub's free stock instead,
 * whole or not at all (`reservation_stock_short`), held to the same date; the old reservation is
 * released as moved. `inventory.stock.adjust`. People only.
 */
export const moveReservation = defineCommand({
  name: 'inventory.reservation.move',
  permission: 'inventory.stock.adjust',
  minScope: 'entity',
  peopleOnly: true,
  input: MoveReservationInput,
  output: ReservationChangedDto,
  auditFields: ['reservationState'],
  async handler(ctx, input) {
    const res = await readReservation(ctx, input.entityId, input.reservationId);
    const moved = transition(reservationMachine, res, 'move', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: {},
    });
    const [row] = await reservationCall<{ ids: string[] }>(
      ctx.tx,
      sql`select app.reservation_move(${res.id}::uuid, ${input.hubId}::uuid) as ids`,
    );
    const made = row?.ids ?? [];
    ctx.audit({
      aggregateType: 'reservation',
      aggregateId: res.id,
      entityId: res.entityId,
      before: { reservationState: res.state },
      after: { reservationState: moved.to },
    });
    for (const id of made) {
      ctx.audit({
        aggregateType: 'reservation',
        aggregateId: id,
        entityId: res.entityId,
        before: null,
        after: { reservationState: 'active' },
      });
    }
    ctx.emit({
      type: 'inventory.reservation.moved',
      entityId: res.entityId,
      aggregateType: 'reservation',
      aggregateId: res.id,
      payload: {
        reservationId: res.id,
        salesOrderId: res.salesOrderId,
        itemId: res.itemId,
        hubId: input.hubId,
        reservationIds: made.slice(0, 200),
      },
    });
    return { reservationIds: made, expiresAt: res.expiresAt };
  },
});
