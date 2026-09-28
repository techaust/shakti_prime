import { newId } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { afterCursor, keysetOrder, nextCursor, orderTerms, type SortKeys } from './keyset-sort';
import { encodeCursor } from './parse-input';

const dialect = new PgDialect();
const text = (q: SQL) => dialect.sqlToQuery(q).sql;

const keys: SortKeys<'name' | 'seen' | 'on'> = {
  name: { expr: sql`"name"`, type: 'text', nullable: false },
  seen: { expr: sql`"seen_at"`, type: 'timestamptz', nullable: true },
  on: { expr: sql`"is_on"`, type: 'boolean', nullable: false },
};
const id = sql`"id"`;
type Column = 'name' | 'seen' | 'on';
const listOrder: { column: Column; direction: 'asc' | 'desc' } = {
  column: 'name',
  direction: 'asc',
};
const byName = keysetOrder(keys, id, undefined, listOrder);
const bySeenDown = keysetOrder(keys, id, { column: 'seen', direction: 'desc' }, listOrder);

describe('keysetOrder', () => {
  it('takes the asked-for column, or the list’s own order', () => {
    expect(byName.name).toBe('name');
    expect(bySeenDown).toMatchObject({ name: 'seen', direction: 'desc' });
  });
});

describe('orderTerms', () => {
  it('puts empty values last only for a column that can be empty, and ties by id', () => {
    expect(orderTerms(byName).map(text)).toEqual(['"name" asc', '"id" asc']);
    expect(orderTerms(bySeenDown).map(text)).toEqual(['"seen_at" desc nulls last', '"id" desc']);
  });
});

describe('afterCursor and nextCursor', () => {
  it('compares the value and id as a tuple, with empty values after the rest', () => {
    const cursor = nextCursor(bySeenDown, true, {
      value: '2026-09-28 10:00:00.123456+00',
      id: newId(),
    });
    expect(cursor).not.toBeNull();
    const where = afterCursor(bySeenDown, cursor ?? undefined);
    expect(where === undefined ? '' : text(where)).toBe(
      '(("seen_at", "id") < ($1::text::timestamptz, $2::uuid) or "seen_at" is null)',
    );
  });

  it('continues among empty values by id after an empty one', () => {
    const cursor = nextCursor(bySeenDown, true, { value: null, id: newId() });
    const where = afterCursor(bySeenDown, cursor ?? undefined);
    expect(where === undefined ? '' : text(where)).toBe('("seen_at" is null and "id" < $1::uuid)');
  });

  it('gives no cursor on the last page, and no condition on the first', () => {
    expect(nextCursor(byName, false, { value: 'Asha', id: newId() })).toBeNull();
    expect(nextCursor(byName, true, undefined)).toBeNull();
    expect(afterCursor(byName, undefined)).toBeUndefined();
  });

  it('refuses a cursor made for another order, or one whose value is not of the column’s kind', () => {
    const named = nextCursor(byName, true, { value: 'Asha', id: newId() }) ?? '';
    expect(() => afterCursor(bySeenDown, named)).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
    const onOrder = keysetOrder(keys, id, { column: 'on', direction: 'asc' }, listOrder);
    const forged = encodeCursor({ s: 'on.asc', v: 'yes', id: newId() });
    expect(() => afterCursor(onOrder, forged)).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
    expect(() => afterCursor(byName, 'bm90IGEgY3Vyc29y')).toThrow(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });
});
