import { describe, expect, it } from 'vitest';
import { EntityIdSchema, IdSchema, newId } from './ids';

describe('newId', () => {
  it('produces a UUID with version 7 and the RFC variant', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(IdSchema.parse(id)).toBe(id);
  });

  it('is time-ordered so consecutive ids sort in creation order', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });

  it('rejects other UUID versions', () => {
    expect(IdSchema.safeParse('123e4567-e89b-42d3-a456-426614174000').success).toBe(false);
  });
});

describe('EntityIdSchema', () => {
  it('accepts smallint range only', () => {
    expect(EntityIdSchema.parse(4)).toBe(4);
    expect(EntityIdSchema.safeParse(0).success).toBe(false);
    expect(EntityIdSchema.safeParse(40000).success).toBe(false);
  });
});
