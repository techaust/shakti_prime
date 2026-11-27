import { DomainError } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { stockRefusal } from './move';

/** A database failure as the driver wraps it: the Postgres error is the cause. */
function failure(code: string, constraint: string, detail?: string): Error {
  const cause = Object.assign(new Error('failed'), {
    code,
    constraint_name: constraint,
    detail,
  });
  return new Error('query failed', { cause });
}

describe('stockRefusal', () => {
  it('answers a definer’s refusal with its catalogue reason and facts', () => {
    const e = stockRefusal(
      failure('23514', 'stock_reserved_insufficient', '{"itemId":"i","binCode":"A1","cost":"9"}'),
    );
    expect(e).toBeInstanceOf(DomainError);
    expect(e?.code).toBe('conflict');
    expect(e?.details).toEqual({ itemId: 'i', binCode: 'A1', reason: 'stock_reserved_insufficient' });
  });

  it('answers reserved stock above what a bin holds as stock that is short, never an internal error', () => {
    const e = stockRefusal(
      failure('23514', 'stock_balances_reserved_on_hand_check', 'Failing row contains (…)'),
    );
    expect(e?.code).toBe('conflict');
    expect(e?.details).toEqual({ reason: 'reservation_stock_short' });
  });

  it('leaves any other failure to the runner', () => {
    expect(stockRefusal(failure('23514', 'items_sku_check'))).toBeUndefined();
    expect(stockRefusal(failure('40P01', 'stock_balances_reserved_on_hand_check'))).toBeUndefined();
    expect(stockRefusal(new Error('plain'))).toBeUndefined();
  });
});
