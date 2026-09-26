import { describe, expect, it } from 'vitest';
import { memoryKeyValue } from './key-value';

describe('memoryKeyValue', () => {
  it('expires values and counts increments within the first time to live', async () => {
    let clock = 0;
    const kv = memoryKeyValue(() => clock);
    await kv.set('a', '1', 10);
    expect(await kv.get('a')).toBe('1');
    clock = 10_001;
    expect(await kv.get('a')).toBeNull();

    expect(await kv.incr('n', 5)).toBe(1);
    expect(await kv.incr('n', 5)).toBe(2);
    clock = 20_000;
    expect(await kv.incr('n', 5)).toBe(1);
    await kv.del('n');
    expect(await kv.get('n')).toBeNull();
  });
});
