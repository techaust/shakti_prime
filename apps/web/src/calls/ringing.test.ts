import { memoryKeyValue } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { holdRinging, RINGING_TTL_SECONDS, ringingKey, takeRinging } from './ringing';

const POP = {
  providerCallId: '01a1e99a-ac5e-7726-bde8-2fb433596282',
  entityId: 2,
  accountIds: ['01a1e99a-af91-76d1-83ca-7bab32272e3b'],
  phone: '+919812345678',
  ringingAt: '2026-11-17T06:30:00.000Z',
};
const PERSON = '01a1e99a-b000-7000-8000-000000000001';
const OTHER = '01a1e99a-b000-7000-8000-000000000002';

describe('the ringing call store', () => {
  it('gives a person their own ringing call once, and nobody else’s', async () => {
    const kv = memoryKeyValue();
    await holdRinging(kv, PERSON, POP);
    expect(await takeRinging(kv, OTHER)).toBeUndefined();
    expect(await takeRinging(kv, PERSON)).toEqual(POP);
    expect(await takeRinging(kv, PERSON)).toBeUndefined();
  });

  it('lets a call go once it has rung a minute', async () => {
    let now = 0;
    const kv = memoryKeyValue(() => now);
    await holdRinging(kv, PERSON, POP);
    now = RINGING_TTL_SECONDS * 1000 + 1;
    expect(await takeRinging(kv, PERSON)).toBeUndefined();
  });

  it('keeps the later of two calls', async () => {
    const kv = memoryKeyValue();
    await holdRinging(kv, PERSON, POP);
    const later = { ...POP, providerCallId: '01a1e99a-ac5e-7726-bde8-2fb433596283' };
    await holdRinging(kv, PERSON, later);
    expect(await takeRinging(kv, PERSON)).toEqual(later);
  });

  it('clears and answers nothing for anything that is not a ringing call', async () => {
    const kv = memoryKeyValue();
    await kv.set(ringingKey(PERSON), 'not a call', 60);
    expect(await takeRinging(kv, PERSON)).toBeUndefined();
    expect(await kv.get(ringingKey(PERSON))).toBeNull();
    await expect(holdRinging(kv, PERSON, { ...POP, phone: '98123' })).rejects.toThrow();
  });

  it('gives a call to one of two screens asking at the same moment', async () => {
    const kv = memoryKeyValue();
    await holdRinging(kv, PERSON, POP);
    const [a, b] = await Promise.all([takeRinging(kv, PERSON), takeRinging(kv, PERSON)]);
    expect([a, b].filter((p) => p !== undefined)).toEqual([POP]);
  });
});
