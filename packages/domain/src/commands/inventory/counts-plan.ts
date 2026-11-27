import { DomainError, type SerialState, type StockReason } from '@shakti/contracts';
import type { SerialEvent, SerialRecord } from '../../state-machines/machines/serial';
import type { StockMovementLine } from '../../stock/move';

/**
 * How a reviewed count posts (H3, docs/03-roadmap-appendix/phase3.md §7.3), as a pure plan: each
 * line's variance is what stands counted less what the ledger held in the bin when it was counted,
 * and becomes one `count` movement: out of the bin for less, into it for more. A serial missing is
 * written off from its bin; a serial found is brought back into the bin it was counted in, written
 * off first from the bin the ledger has it in when that is another. Every movement out comes
 * before every movement in, so a serial found elsewhere leaves its old bin first.
 */

/** One line of `app.stock_count_review()`, as the posting reads it. */
export interface CountLineFacts {
  lineId: string;
  binId: string;
  itemId: string;
  serialId: string | null;
  serialNo: string | null;
  /** What stands counted; null while uncounted or asked for again. */
  finalQty: string | null;
  /** What the ledger held in the bin when the line was counted. */
  expectedAtCount: string;
  serialMovedSince: boolean;
  serialState: SerialState | null;
  serialBinId: string | null;
}

/** The ledger's reason for every movement a count posts (a constant, so no catalogue reads it). */
const COUNT: Extract<StockReason, 'count'> = 'count';

/** A planned movement with the serial event the command fires for it first. */
export interface PlannedMove {
  line: StockMovementLine;
  serial: { event: SerialEvent; record: SerialRecord; fromBinId: string | null } | null;
  serialNo: string | null;
}

/** Thousandths of a unit, the ledger's precision, as an exact integer. */
export function toMilli(value: string): number {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, '0').slice(0, 3));
  return negative ? -milli : milli;
}

/** Thousandths back to the ledger's three decimals, with a sign when below zero. */
export function fromMilli(milli: number): string {
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  return `${sign}${String(Math.floor(abs / 1000))}.${String(abs % 1000).padStart(3, '0')}`;
}

/** A line's variance in thousandths, or null while it has no count that stands. */
export function varianceMilli(line: Pick<CountLineFacts, 'finalQty' | 'expectedAtCount'>) {
  return line.finalQty === null ? null : toMilli(line.finalQty) - toMilli(line.expectedAtCount);
}

function serialMoved(serialNo: string | null): DomainError {
  return new DomainError('conflict', 'serial moved since it was counted', {
    reason: 'stock_count_serial_moved',
    ...(serialNo === null ? {} : { serialNo }),
  });
}

/**
 * The movements a count posts, outs first. `noteOf` gives each line's note: the poster's, or a
 * missing serial's own reason.
 */
export function planCountMoves(
  entityId: number,
  countId: string,
  lines: readonly CountLineFacts[],
  noteOf: (lineId: string) => string,
): PlannedMove[] {
  const outs: PlannedMove[] = [];
  const ins: PlannedMove[] = [];
  const base = { reason: COUNT, entityId, refType: 'stock_count', refId: countId };
  // Serials written off by a line of their own, so a find elsewhere does not write them off twice.
  const leaving = new Set<string>();
  for (const line of lines) {
    const v = varianceMilli(line);
    if (v === null) {
      throw new DomainError('conflict', 'a line has no count', { reason: 'stock_count_uncounted' });
    }
    if (v === 0 || line.serialId === null || v > 0) continue;
    if (line.serialMovedSince) throw serialMoved(line.serialNo);
    leaving.add(line.serialId);
    outs.push({
      line: {
        ...base,
        itemId: line.itemId,
        serialId: line.serialId,
        fromBinId: line.binId,
        qty: '1',
        note: noteOf(line.lineId),
      },
      serial: {
        event: 'scrap',
        record: { state: line.serialState, binId: line.serialBinId },
        fromBinId: line.binId,
      },
      serialNo: line.serialNo,
    });
  }
  for (const line of lines) {
    const v = varianceMilli(line) ?? 0;
    if (v === 0) continue;
    const note = noteOf(line.lineId);
    if (line.serialId === null) {
      const move: StockMovementLine =
        v > 0
          ? { ...base, itemId: line.itemId, toBinId: line.binId, qty: fromMilli(v), note }
          : { ...base, itemId: line.itemId, fromBinId: line.binId, qty: fromMilli(-v), note };
      (v > 0 ? ins : outs).push({ line: move, serial: null, serialNo: null });
      continue;
    }
    if (v < 0) continue;
    if (line.serialMovedSince) throw serialMoved(line.serialNo);
    const state = line.serialState;
    if (state !== 'scrapped' && state !== 'in_stock') {
      throw new DomainError('conflict', 'serial held elsewhere', {
        reason: 'stock_count_serial_elsewhere',
        ...(line.serialNo === null ? {} : { serialNo: line.serialNo }),
      });
    }
    if (state === 'in_stock' && line.serialBinId === line.binId) continue;
    if (state === 'in_stock' && line.serialBinId !== null && !leaving.has(line.serialId)) {
      leaving.add(line.serialId);
      outs.push({
        line: {
          ...base,
          itemId: line.itemId,
          serialId: line.serialId,
          fromBinId: line.serialBinId,
          qty: '1',
          note,
        },
        serial: {
          event: 'scrap',
          record: { state, binId: line.serialBinId },
          fromBinId: line.serialBinId,
        },
        serialNo: line.serialNo,
      });
    }
    ins.push({
      line: {
        ...base,
        itemId: line.itemId,
        serialId: line.serialId,
        toBinId: line.binId,
        qty: '1',
        note,
      },
      serial: { event: 'reinstate', record: { state: 'scrapped', binId: null }, fromBinId: null },
      serialNo: line.serialNo,
    });
  }
  return [...outs, ...ins];
}
