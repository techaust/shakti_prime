import { DomainError } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  fromMilli,
  planCountMoves,
  toMilli,
  varianceMilli,
  type CountLineFacts,
} from './counts-plan';

const COUNT = '01990000-0000-7000-8000-00000000c0c0';
const A = 'bin-a';
const B = 'bin-b';

function line(over: Partial<CountLineFacts>): CountLineFacts {
  return {
    lineId: `line-${Math.random().toString(36).slice(2)}`,
    binId: A,
    itemId: 'cable',
    serialId: null,
    serialNo: null,
    finalQty: '0.000',
    expectedAtCount: '0.000',
    serialMovedSince: false,
    serialState: null,
    serialBinId: null,
    ...over,
  };
}

const note = () => 'Year-end count';

describe('quantities in thousandths', () => {
  it('read and write the ledger’s three decimals exactly, signs included', () => {
    expect(toMilli('12.345')).toBe(12345);
    expect(toMilli('-0.5')).toBe(-500);
    expect(toMilli('7')).toBe(7000);
    expect(fromMilli(-2500)).toBe('-2.500');
    expect(fromMilli(1)).toBe('0.001');
    expect(fromMilli(0)).toBe('0.000');
    // 0.1 + 0.2 in floating point is not 0.3; in thousandths it is.
    expect(fromMilli(toMilli('0.1') + toMilli('0.2'))).toBe('0.300');
  });

  it('give no variance while a line has no count that stands', () => {
    expect(varianceMilli({ finalQty: null, expectedAtCount: '3.000' })).toBeNull();
    expect(varianceMilli({ finalQty: '2.500', expectedAtCount: '3.000' })).toBe(-500);
  });
});

describe('planCountMoves', () => {
  it('moves an untracked shortfall out and a surplus in, outs first, nothing for a match', () => {
    const plan = planCountMoves(
      1,
      COUNT,
      [
        line({ binId: A, finalQty: '12.000', expectedAtCount: '10.000' }),
        line({ binId: B, finalQty: '7.500', expectedAtCount: '10.000' }),
        line({ binId: 'bin-c', finalQty: '4.000', expectedAtCount: '4.000' }),
      ],
      note,
    );
    expect(plan.map((p) => [p.line.fromBinId ?? null, p.line.toBinId ?? null, p.line.qty])).toEqual(
      [
        [B, null, '2.500'],
        [null, A, '2.000'],
      ],
    );
    expect(
      plan.every(
        (p) => p.line.reason === 'count' && p.line.refId === COUNT && p.line.note === note(),
      ),
    ).toBe(true);
  });

  it('writes off a missing serial from its bin with its own reason', () => {
    const missing = line({
      serialId: 's1',
      serialNo: 'P-1',
      itemId: 'pump',
      finalQty: '0.000',
      expectedAtCount: '1.000',
      serialState: 'in_stock',
      serialBinId: A,
    });
    const [move] = planCountMoves(1, COUNT, [missing], (id) =>
      id === missing.lineId ? 'Not on the shelf' : note(),
    );
    expect(move?.line).toMatchObject({
      serialId: 's1',
      fromBinId: A,
      qty: '1',
      note: 'Not on the shelf',
    });
    expect(move?.serial).toMatchObject({ event: 'scrap', fromBinId: A });
  });

  it('brings back a serial written off, and moves one the ledger has in another bin', () => {
    const scrapped = line({
      serialId: 's2',
      finalQty: '1.000',
      expectedAtCount: '0.000',
      serialState: 'scrapped',
    });
    const elsewhere = line({
      serialId: 's3',
      binId: A,
      finalQty: '1.000',
      expectedAtCount: '0.000',
      serialState: 'in_stock',
      serialBinId: B,
    });
    const plan = planCountMoves(1, COUNT, [scrapped, elsewhere], note);
    expect(
      plan.map((p) => [
        p.line.serialId,
        p.line.fromBinId ?? null,
        p.line.toBinId ?? null,
        p.serial?.event,
      ]),
    ).toEqual([
      ['s3', B, null, 'scrap'],
      ['s2', null, A, 'reinstate'],
      ['s3', null, A, 'reinstate'],
    ]);
  });

  it('writes a serial off once when its own line in the other bin is missing too', () => {
    const plan = planCountMoves(
      1,
      COUNT,
      [
        line({
          serialId: 's4',
          binId: A,
          finalQty: '1.000',
          serialState: 'in_stock',
          serialBinId: B,
        }),
        line({
          serialId: 's4',
          binId: B,
          finalQty: '0.000',
          expectedAtCount: '1.000',
          serialState: 'in_stock',
          serialBinId: B,
        }),
      ],
      note,
    );
    expect(plan.map((p) => [p.line.fromBinId ?? null, p.line.toBinId ?? null])).toEqual([
      [B, null],
      [null, A],
    ]);
  });

  it('refuses a line with no count, a serial moved since its count, and one held elsewhere', () => {
    const refusal = (lines: CountLineFacts[]) => {
      try {
        planCountMoves(1, COUNT, lines, note);
      } catch (e) {
        return e instanceof DomainError ? e.details : undefined;
      }
      return undefined;
    };
    expect(refusal([line({ finalQty: null })])).toMatchObject({ reason: 'stock_count_uncounted' });
    expect(
      refusal([
        line({ serialId: 's5', serialNo: 'P-5', expectedAtCount: '1.000', serialMovedSince: true }),
      ]),
    ).toMatchObject({ reason: 'stock_count_serial_moved', serialNo: 'P-5' });
    expect(
      refusal([line({ serialId: 's6', finalQty: '1.000', serialState: 'with_customer' })]),
    ).toMatchObject({ reason: 'stock_count_serial_elsewhere' });
  });
});
