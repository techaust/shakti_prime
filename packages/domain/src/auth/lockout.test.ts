import { describe, expect, it } from 'vitest';
import { memoryKeyValue, type KeyValue } from '../ports/key-value';
import {
  createLockout,
  createSignInGuard,
  lockoutDelaySeconds,
  SIGN_IN_NOTICE_EVERY,
} from './lockout';

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
    await store.set('lockout:acct:x:count', 'not a number', 60);
    await store.set('lockout:acct:x:last', 'not a time', 60);
    await expect(createLockout(store).check(['acct:x'])).resolves.toBeUndefined();
  });

  it('counts every one of many failures that arrive at the same moment', async () => {
    const clock = 1_000_000;
    const memory = memoryKeyValue(() => clock);
    // Every call yields before it reaches the store, so the failures interleave as they would
    // across serverless instances: a read, change and write of the count would lose all but one.
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const store: KeyValue = {
      get: async (key) => {
        await tick();
        return memory.get(key);
      },
      set: async (key, value, ttl) => {
        await tick();
        await memory.set(key, value, ttl);
      },
      del: async (key) => {
        await tick();
        await memory.del(key);
      },
      incr: async (key, ttl) => {
        await tick();
        return memory.incr(key, ttl);
      },
      setIfAbsent: async (key, value, ttl) => {
        await tick();
        return memory.setIfAbsent(key, value, ttl);
      },
      raiseTo: async (key, value, ttl) => {
        await tick();
        return memory.raiseTo(key, value, ttl);
      },
    };
    const lockout = createLockout(store, () => clock);
    const keys = ['acct:asha@shakti.test', 'ip:10.0.0.1'];

    await Promise.all(Array.from({ length: 8 }, () => lockout.recordFailure(keys)));

    expect(await memory.get('lockout:acct:asha@shakti.test:count')).toBe('8');
    expect(await memory.get('lockout:ip:10.0.0.1:count')).toBe('8');
    await expect(lockout.check(keys)).rejects.toMatchObject({
      details: { retryAfterSeconds: lockoutDelaySeconds(8) },
    });
  });
});

describe('createSignInGuard (AUDIT M6)', () => {
  const email = 'Asha@Shakti.test';
  const office = '10.0.0.1';

  it('locks one account from one address, not the account elsewhere or the address for others', async () => {
    let clock = 1_000_000;
    const guard = createSignInGuard(
      memoryKeyValue(() => clock),
      () => clock,
    );
    for (let i = 0; i < 5; i += 1) await guard.recordFailure(email, office);
    await expect(guard.check(email, office)).rejects.toMatchObject({
      details: { reason: 'account_locked', retryAfterSeconds: 60 },
    });
    await expect(guard.check('asha@shakti.test', office)).rejects.toMatchObject({
      code: 'rate_limited',
    });
    await expect(guard.check(email, '10.0.0.2')).resolves.toBeUndefined();
    await expect(guard.check('ravi@shakti.test', office)).resolves.toBeUndefined();

    await guard.succeeded(email, '10.0.0.2');
    await expect(guard.check(email, office)).rejects.toMatchObject({ code: 'rate_limited' });
    clock += 61_000;
    await expect(guard.check(email, office)).resolves.toBeUndefined();
  });

  it('tells the owner at every tenth failure from any address', async () => {
    const guard = createSignInGuard(memoryKeyValue());
    const notices: boolean[] = [];
    for (let i = 0; i < SIGN_IN_NOTICE_EVERY * 2; i += 1) {
      notices.push((await guard.recordFailure(email, `10.0.1.${String(i)}`)).notify);
    }
    expect(notices.filter(Boolean)).toHaveLength(2);
    expect(notices[SIGN_IN_NOTICE_EVERY - 1]).toBe(true);
  });

  it('locks and tells the owner once when ten failures arrive together', async () => {
    const guard = createSignInGuard(memoryKeyValue());
    const results = await Promise.all(
      Array.from({ length: SIGN_IN_NOTICE_EVERY }, () => guard.recordFailure(email, office)),
    );
    expect(results.filter((r) => r.notify)).toHaveLength(1);
    await expect(guard.check(email, office)).rejects.toMatchObject({
      details: { retryAfterSeconds: lockoutDelaySeconds(SIGN_IN_NOTICE_EVERY) },
    });
  });

  it('an administrator clears every lock on the account at once', async () => {
    const guard = createSignInGuard(memoryKeyValue());
    for (const address of ['10.0.2.1', '10.0.2.2']) {
      for (let i = 0; i < 5; i += 1) await guard.recordFailure(email, address);
      await expect(guard.check(email, address)).rejects.toMatchObject({ code: 'rate_limited' });
    }
    await guard.clear(email);
    await expect(guard.check(email, '10.0.2.1')).resolves.toBeUndefined();
    await expect(guard.check(email, '10.0.2.2')).resolves.toBeUndefined();
  });
});
