import { newId, type Principal } from '@shakti/contracts';
import {
  createLockout,
  LOCKOUT_FREE_ATTEMPTS,
  memoryKeyValue,
  type KeyValue,
  type UserAccess,
} from '@shakti/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { principalCache } from './principal-cache';
import { upstashKeyValue } from './upstash-key-value';

// The production adapter runs the real @upstash/redis client against an in-process stand-in for
// the Upstash REST API, so SDK behaviour (response encoding, deserialisation, transactions) is
// exercised rather than mocked away. Every other test uses the in-memory store, which is how the
// "[object Object]" defect went unseen (AUDIT C1).

const principal: Principal = {
  id: newId(),
  kind: 'user',
  roleKey: 'general_manager',
  entityIds: [1, 2],
  permissions: [{ key: 'crm.lead.read', scope: 'entity' }],
};

const access: UserAccess = {
  status: 'active',
  theme: 'system',
  name: 'Suman Rathore',
  email: 'suman@shakti.example',
  twoFactorEnabled: true,
  entities: [
    {
      entityId: 1,
      entityName: 'Shakti Supreme',
      roleKey: 'general_manager',
      teamId: null,
      grants: [{ key: 'crm.lead.read', scope: 'entity' }],
    },
  ],
};

interface Cell {
  value: string;
  expiresAt: number | null;
}
type Command = (string | number)[];

function fakeUpstash(now: () => number) {
  const cells = new Map<string, Cell>();
  let failNextTransaction = false;

  const live = (key: string): Cell | undefined => {
    const cell = cells.get(key);
    if (cell?.expiresAt !== null && cell !== undefined && cell.expiresAt <= now()) {
      cells.delete(key);
      return undefined;
    }
    return cell;
  };

  // Returns the reply and whether it is a status reply, which Upstash does not encode.
  function run(command: Command): { reply: unknown; status?: boolean } {
    const [name, key = '', ...args] = command.map(String);
    switch (name?.toUpperCase()) {
      case 'GET':
        return { reply: live(key)?.value ?? null };
      case 'SET': {
        const upper = args.map((a) => a.toUpperCase());
        const exAt = upper.indexOf('EX');
        const ttl = exAt === -1 ? undefined : Number(args[exAt + 1]);
        if (upper.includes('NX') && live(key) !== undefined) return { reply: null };
        cells.set(key, {
          value: args[0] ?? '',
          expiresAt: ttl === undefined ? null : now() + ttl * 1000,
        });
        return { reply: 'OK', status: true };
      }
      case 'DEL':
        return { reply: cells.delete(key) ? 1 : 0 };
      case 'INCR': {
        const cell = live(key);
        const next = (cell ? Number(cell.value) : 0) + 1;
        cells.set(key, { value: String(next), expiresAt: cell?.expiresAt ?? null });
        return { reply: next };
      }
      default:
        throw new Error(`fake Upstash does not implement ${name}`);
    }
  }

  const encode = ({ reply, status }: { reply: unknown; status?: boolean }, base64: boolean) =>
    base64 && typeof reply === 'string' && !status
      ? Buffer.from(reply, 'utf8').toString('base64')
      : reply;

  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input.toString();
    const headers = new Headers(init?.headers);
    const base64 = headers.get('Upstash-Encoding') === 'base64';
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as
      Command | Command[];
    // Auto-pipelining sends even single commands to /pipeline as a list.
    if (url.endsWith('/pipeline')) {
      const replies = (body as Command[]).map((c) => ({ result: encode(run(c), base64) }));
      return Promise.resolve(new Response(JSON.stringify(replies)));
    }
    if (url.endsWith('/multi-exec')) {
      if (failNextTransaction) {
        failNextTransaction = false;
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'transaction aborted' }), { status: 500 }),
        );
      }
      const replies = (body as Command[]).map((c) => ({ result: encode(run(c), base64) }));
      return Promise.resolve(new Response(JSON.stringify(replies)));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ result: encode(run(body as Command), base64) })),
    );
  };

  return {
    fetch,
    ttlSeconds: (key: string) => {
      const cell = live(key);
      if (!cell) return -2;
      return cell.expiresAt === null ? -1 : Math.ceil((cell.expiresAt - now()) / 1000);
    },
    failNextTransaction: () => {
      failNextTransaction = true;
    },
  };
}

let clock = 1_000_000;
const now = () => clock;
let upstash: ReturnType<typeof fakeUpstash>;

beforeEach(() => {
  clock = 1_000_000;
  upstash = fakeUpstash(now);
  vi.stubGlobal('fetch', upstash.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const stores: [string, () => KeyValue][] = [
  ['memory', () => memoryKeyValue(now)],
  ['upstash', () => upstashKeyValue({ url: 'https://fake.upstash.test', token: 'test-token' })],
];

describe.each(stores)('KeyValue contract: %s', (_name, make) => {
  it('returns exactly the string that was stored, JSON included', async () => {
    const kv = make();
    const json = JSON.stringify({ principal: { id: 'x' }, access: { entities: [] } });
    await kv.set('json', json, 60);
    await kv.set('digits', '42', 60);
    expect(await kv.get('json')).toBe(json);
    expect(await kv.get('digits')).toBe('42');
    expect(await kv.get('missing')).toBeNull();
  });

  it('expires values after their time to live and deletes on request', async () => {
    const kv = make();
    await kv.set('a', 'one', 10);
    clock += 9_000;
    expect(await kv.get('a')).toBe('one');
    clock += 1_001;
    expect(await kv.get('a')).toBeNull();
    await kv.set('b', 'two', 10);
    await kv.del('b');
    expect(await kv.get('b')).toBeNull();
  });

  it('counts within the first window and starts again after it', async () => {
    const kv = make();
    expect(await kv.incr('n', 5)).toBe(1);
    clock += 4_000;
    expect(await kv.incr('n', 5)).toBe(2);
    clock += 1_001;
    expect(await kv.incr('n', 5)).toBe(1);
  });

  it('engages the sign-in lockout after the free attempts', async () => {
    const lockout = createLockout(make(), now);
    for (let i = 0; i < LOCKOUT_FREE_ATTEMPTS; i++) await lockout.recordFailure(['acct:a@b.in']);
    await expect(lockout.check(['acct:a@b.in'])).rejects.toMatchObject({
      code: 'rate_limited',
      details: { reason: 'account_locked' },
    });
    await lockout.reset(['acct:a@b.in']);
    await expect(lockout.check(['acct:a@b.in'])).resolves.toBeUndefined();
  });

  it('round-trips a cached principal', async () => {
    const cache = principalCache(make());
    const key = await cache.keyFor(principal.id, 'session-1', undefined);
    await cache.write(key, { principal, access });
    expect(await cache.read(key)).toEqual({ principal, access });
    await cache.invalidate(principal.id);
    const next = await cache.keyFor(principal.id, 'session-1', undefined);
    expect(next).not.toBe(key);
    expect(await cache.read(next)).toBeUndefined();
  });
});

describe('upstash adapter', () => {
  const kv = () => upstashKeyValue({ url: 'https://fake.upstash.test', token: 'test-token' });

  it('never leaves a counter without a time to live, even when the transaction fails', async () => {
    const store = kv();
    upstash.failNextTransaction();
    await expect(store.incr('cap:/change-password:1.2.3.4', 60)).rejects.toThrow();
    expect(upstash.ttlSeconds('cap:/change-password:1.2.3.4')).toBe(-2);
    expect(await store.incr('cap:/change-password:1.2.3.4', 60)).toBe(1);
    expect(upstash.ttlSeconds('cap:/change-password:1.2.3.4')).toBe(60);
  });
});

describe('principal cache failures are misses, not errors', () => {
  const failing: KeyValue = {
    get: () => Promise.reject(new Error('store unreachable')),
    set: () => Promise.reject(new Error('store unreachable')),
    del: () => Promise.reject(new Error('store unreachable')),
    incr: () => Promise.reject(new Error('store unreachable')),
  };

  it('answers a miss when the store is unreachable, and invalidation still reports failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cache = principalCache(failing);
    const key = await cache.keyFor(principal.id, 'session-1', 2);
    expect(key).toBeUndefined();
    expect(await cache.read(key)).toBeUndefined();
    await expect(cache.write(key, { principal, access })).resolves.toBeUndefined();
    await expect(cache.invalidate(principal.id)).rejects.toThrow('store unreachable');
  });

  it('treats an unreadable or foreign entry as a miss', async () => {
    const store = memoryKeyValue(now);
    const cache = principalCache(store);
    const key = await cache.keyFor(principal.id, 'session-1', undefined);
    if (key === undefined) throw new Error('memory store always yields a key');
    await store.set(key, '[object Object]', 60);
    expect(await cache.read(key)).toBeUndefined();
    await store.set(key, JSON.stringify({ principal: { id: 'not-a-principal' }, access }), 60);
    expect(await cache.read(key)).toBeUndefined();
  });
});
