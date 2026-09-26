import { describe, expect, it } from 'vitest';
import { memoryKeyValue } from '../ports/key-value';
import { createLockout, lockoutDelaySeconds } from './lockout';

describe('lockoutDelaySeconds', () => {
  it('waits nothing for the first five failures, then doubles from a minute to an hour', () => {
    expect([0, 1, 2, 3, 4].map(lockoutDelaySeconds)).toEqual([0, 0, 0, 0, 0]);
    expect(lockoutDelaySeconds(5)).toBe(60);
    expect(lockoutDelaySeconds(6)).toBe(120);
    expect(lockoutDelaySeconds(8)).toBe(480);
    expect(lockoutDelaySeconds(10)).toBe(1920);
    expect(lockoutDelaySeconds(11)).toBe(3600);
    expect(lockoutDelaySeconds(40)).toBe(3600);
  });
});

describe('createLockout', () => {
  it('locks the account and the address after five failures and clears on success', async () => {
    let clock = 1_000_000;
    const store = memoryKeyValue(() => clock);
    const lockout = createLockout(store, () => clock);
    const keys = ['acct:asha@shakti.test', 'ip:10.0.0.1'];

    for (let i = 0; i < 4; i += 1) {
      await lockout.recordFailure(keys);
      await expect(lockout.check(keys)).resolves.toBeUndefined();
    }
    await lockout.recordFailure(keys);
    await expect(lockout.check(keys)).rejects.toMatchObject({
      code: 'rate_limited',
      details: { reason: 'account_locked', retryAfterSeconds: 60 },
    });
    await expect(lockout.check(['ip:10.0.0.1'])).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(lockout.check(['acct:other@shakti.test'])).resolves.toBeUndefined();

    clock += 61_000;
    await expect(lockout.check(keys)).resolves.toBeUndefined();
    await lockout.recordFailure(keys);
    await expect(lockout.check(keys)).rejects.toMatchObject({
      details: { retryAfterSeconds: 120 },
    });

    await lockout.reset(keys);
    await expect(lockout.check(keys)).resolves.toBeUndefined();
  });

  it('ignores a corrupt stored value', async () => {
    const store = memoryKeyValue();
    await store.set('lockout:acct:x', 'not json', 60);
    await expect(createLockout(store).check(['acct:x'])).resolves.toBeUndefined();
  });
});
