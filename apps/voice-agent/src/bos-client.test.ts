import { AskStreamEvent, newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { BosClient, REFRESH_BEFORE_MS, REFRESH_RETRY_MS, type BosClientDeps } from './bos-client';
import { parseDrafts, spokenText } from './responders';
import { SpendMeter } from './spend';
import { WavRecorder } from './wav-recorder';

// The worker's way into the BOS (SECURITY §3.4): the session's token, refreshed a minute before
// it expires, and the session's end when the BOS refuses it. `fetch` is a stand-in.

const API = 'https://bos.shakti.test/api/v1';
const T0 = Date.parse('2026-11-17T06:00:00.000Z');

function deps(answer: (url: string, init?: RequestInit) => Promise<Response>) {
  let now = T0;
  const timers: { fn: () => void; ms: number }[] = [];
  const calls: { url: string; auth: string | null }[] = [];
  const d: BosClientDeps = {
    fetch: (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return answer(url, init);
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t as (typeof timers)[number]);
      if (i !== -1) timers.splice(i, 1);
    },
  };
  return {
    d,
    calls,
    timers,
    advance: (ms: number) => (now += ms),
    fire: async () => {
      const due = timers.splice(0);
      for (const t of due) t.fn();
      for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    },
  };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A token of the shape the BOS signs (an ES256 JWT); the worker never reads its claims. */
const token = (n: number) => ({
  token: `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ n })}.c2lnbmF0dXJl`,
  expiresAt: new Date(T0 + n * 300_000).toISOString(),
});

describe('the session token', () => {
  it('is refreshed a minute before it expires, with the current token, again and again', async () => {
    let n = 1;
    const env = deps(() => {
      n += 1;
      return Promise.resolve(Response.json(token(n)));
    });
    let ended = 0;
    const client = new BosClient(API, token(1), () => (ended += 1), env.d);
    client.start();
    expect(env.timers.map((t) => t.ms)).toEqual([300_000 - REFRESH_BEFORE_MS]);
    await env.fire();
    expect(env.calls).toEqual([{ url: `${API}/voice/token`, auth: `Bearer ${token(1).token}` }]);
    expect(client.token).toBe(token(2).token);
    await env.fire();
    expect(env.calls.at(-1)?.auth).toBe(`Bearer ${token(2).token}`);
    expect(ended).toBe(0);
    client.stop();
    expect(env.timers).toEqual([]);
  });

  it('ends the session when the BOS refuses it, and tries again only while it lasts', async () => {
    const refused = deps(() =>
      Promise.resolve(
        Response.json(
          { error: { code: 'forbidden', details: { reason: 'voice_session_ended' } } },
          { status: 403 },
        ),
      ),
    );
    let ended = 0;
    new BosClient(API, token(1), () => (ended += 1), refused.d).start();
    await refused.fire();
    expect(ended).toBe(1);
    expect(refused.timers).toEqual([]);

    const unreachable = deps(() => Promise.reject(new Error('offline')));
    let gone = 0;
    new BosClient(API, token(1), () => (gone += 1), unreachable.d).start();
    unreachable.advance(300_000 - REFRESH_BEFORE_MS);
    await unreachable.fire();
    expect(unreachable.timers.map((t) => t.ms)).toEqual([REFRESH_RETRY_MS]);
    unreachable.advance(55_000);
    await unreachable.fire();
    expect(gone).toBe(1);
  });
});

describe('a spoken question', () => {
  it("is Ask's answer as the stream's last line, with its cards", async () => {
    const id = newId();
    const turn = {
      conversation: {
        id: newId(),
        entityId: 1,
        entityIds: [1],
        title: 'Leads?',
        createdAt: new Date(T0).toISOString(),
        updatedAt: new Date(T0).toISOString(),
      },
      message: {
        id: newId(),
        conversationId: newId(),
        question: 'Leads?',
        answer: `Qualified has 12 open leads [ref:${id}].`,
        outcome: 'answered',
        unsourced: 0,
        cited: [{ kind: 'opportunity', id }],
        createdAt: new Date(T0).toISOString(),
      },
    };
    const source = {
      kind: 'opportunity',
      id,
      label: 'Synthetic customer',
      entityId: 1,
      accountId: newId(),
    };
    const lines = [
      { type: 'lookup', lookup: 'pipeline_by_stage' },
      { type: 'answer', turn, sources: [source] },
    ];
    // Lines the route itself would send.
    for (const line of lines) expect(AskStreamEvent.safeParse(line).success).toBe(true);
    const env = deps(() =>
      Promise.resolve(new Response(lines.map((l) => JSON.stringify(l)).join('\n'))),
    );
    const client = new BosClient(API, token(1), () => undefined, env.d);
    expect(await client.ask('Leads?')).toEqual({ text: turn.message.answer, sources: [source] });
    expect(env.calls[0]?.url).toBe(`${API}/ask`);
    expect(spokenText(turn.message.answer)).toBe('Qualified has 12 open leads.');

    const failed = deps(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: 'error',
            error: { code: 'rate_limited', reason: 'ask_person_cap_reached' },
          }),
        ),
      ),
    );
    await expect(
      new BosClient(API, token(1), () => undefined, failed.d).ask('Leads?'),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });
});

describe('the worker’s own helpers', () => {
  it('reads drafts only as the contract shapes them, at most five', () => {
    const one = { type: 'faq', audience: 'customer', title: 'Subsidy', text: 'Subsidy milti hai.' };
    expect(
      parseDrafts(`Here: ${JSON.stringify([one, { ...one, type: 'rule' }, { nope: 1 }])}`),
    ).toEqual([{ ...one, id: expect.any(String) as string }]);
    expect(parseDrafts('no drafts')).toEqual([]);
    expect(parseDrafts(JSON.stringify(Array.from({ length: 9 }, () => one)))).toHaveLength(5);
  });

  it('counts the model by its prices and the speech by the minute, rounded up', () => {
    const meter = new SpendMeter({
      model: 'claude-sonnet-5-5',
      effort: 'low',
      thinking: 'between_tools',
      maxTokens: 400,
      draftMaxTokens: 16_000,
      prices: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      paisePerUsd: 10_400,
      speechPaisePerMinute: 50,
    });
    meter.addReply({
      inputTokens: 1_000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    // $0.003 is 31.2 paise, rounded up to 32, and 61 seconds of speech two minutes.
    expect(meter.paise(61_000)).toBe(32 + 100);
  });

  it('keeps every other sample, up to the vault upload size', () => {
    const recorder = new WavRecorder();
    expect(recorder.empty).toBe(true);
    recorder.add(Int16Array.from([1, 2, 3]));
    recorder.add(Int16Array.from([4, 5, 6]));
    const wav = recorder.wav();
    const samples = new Int16Array(wav.buffer.slice(44));
    expect([...samples]).toEqual([1, 3, 5]);
  });
});
