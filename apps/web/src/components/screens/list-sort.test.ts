import { describe, expect, it } from 'vitest';
import { sameSort, sortInput, toListSort } from './list-sort';

const COLUMNS = ['name', 'email'] as const;

describe('toListSort', () => {
  it('passes a sort on a column the list query can sort by', () => {
    expect(toListSort({ columnId: 'email', direction: 'desc' }, COLUMNS)).toEqual({
      column: 'email',
      direction: 'desc',
    });
  });

  it('reads the list in its own order for no sort, or a column the query cannot sort by', () => {
    expect(toListSort(null, COLUMNS)).toBeUndefined();
    expect(toListSort({ columnId: 'status', direction: 'asc' }, COLUMNS)).toBeUndefined();
  });
});

describe('sameSort', () => {
  it('compares the column and the direction', () => {
    expect(sameSort(null, null)).toBe(true);
    expect(sameSort({ columnId: 'name', direction: 'asc' }, null)).toBe(false);
    expect(sameSort(null, { columnId: 'name', direction: 'asc' })).toBe(false);
    expect(
      sameSort({ columnId: 'name', direction: 'asc' }, { columnId: 'name', direction: 'asc' }),
    ).toBe(true);
    expect(
      sameSort({ columnId: 'name', direction: 'asc' }, { columnId: 'name', direction: 'desc' }),
    ).toBe(false);
    expect(
      sameSort({ columnId: 'name', direction: 'asc' }, { columnId: 'email', direction: 'asc' }),
    ).toBe(false);
  });
});

describe('sortInput', () => {
  it('leaves the field out for the list order', () => {
    expect(sortInput(undefined)).toEqual({});
    expect(sortInput({ column: 'name', direction: 'asc' })).toEqual({
      sort: { column: 'name', direction: 'asc' },
    });
  });
});
