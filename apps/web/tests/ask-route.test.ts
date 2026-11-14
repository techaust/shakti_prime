import { AskStreamEvent, ErrorEnvelope, newId, type Principal } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import {
  AGENT_DEFAULTS,
  createAiProvider,
  fakeModelTransport,
  memoryKeyValue,
  memoryLogger,
  personSpendKey,
  recordedAskTransport,
  STAND_IN_ASK,
  type AiProvider,
  type KeyValue,
  type ModelTransport,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askRoute, secondsToIstMidnight, type AskRouteDeps } from '../src/ask/route';
import { askRouteDeps } from '../src/ask/route-deps';

// `POST /api/v1/ask` on real Postgres (docs/06-api.md §3.1): everything that refuses a question
// before the stream, the stream's lines, and a repeated key answered from its record. The model is
// the stand-in recording; the lookups, the filter and the records are real.

const ISSUER = 'http://localhost:3000';
const made: string[] = [];

afterAll(async () => {
  await asMigrator((m) => m`delete from ask_conversations where id = any(${made})`);
  await closeDb();
});

let gm: Principal;
let caller: Principal;

beforeAll(async () => {
  gm = await createTestPrincipal('general_manager', [1]);
  caller = await createTestPrincipal('tele_caller_cc', [1]);
});

/** A transport that counts the model calls it plays. */
function counted(inner: ModelTransport): ModelTransport & { calls: number } {
  const t = {
    calls: 0,
    complete: (r: Parameters<ModelTransport['complete']>[0], s: AbortSignal) => {
      t.calls += 1;
      return inner.complete(r, s);
    },
  };
  return t;
}

function deps(
  principal: Principal | undefined,
  over: { keyValue?: KeyValue; provider?: AiProvider } = {},
): AskRouteDeps & { transport: ModelTransport & { calls: number } } {
  const keyValue = over.keyValue ?? memoryKeyValue();
  const transport = counted(recordedAskTransport(() => STAND_IN_ASK));
  const provider =
    over.provider ??
    createAiProvider({
      claude: transport,
      voyage: fakeModelTransport(),
      keyValue,
      logger: memoryLogger(),
    });
  return {
    ...askRouteDeps(),
    principal: () => Promise.resolve(principal),
    keyValue,
    provider: () => provider,
    options: () => ({}),
    env: { BETTER_AUTH_URL: ISSUER },
    transport,
  };
}

function ask(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ISSUER}/api/v1/ask`, {
    method: 'POST',
    headers: { origin: ISSUER, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function lines(response: Response): Promise<AskStreamEvent[]> {
  const text = await response.text();
  return text
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => AskStreamEvent.parse(JSON.parse(l)));
}

async function failure(response: Response) {
  return { status: response.status, body: ErrorEnvelope.parse(await response.json()) };
}

describe('POST /api/v1/ask', () => {
  it('refuses another site, nobody signed in, a bearer token it cannot read, and a person without knowledge.ask', async () => {
    expect(
      (
        await askRoute(
          ask({ question: 'Leads?' }, { origin: 'https://elsewhere.example' }),
          deps(gm),
        )
      ).status,
    ).toBe(403);
    expect((await askRoute(ask({ question: 'Leads?' }), deps(undefined))).status).toBe(401);
    expect(
      (
        await askRoute(
          ask({ question: 'Leads?' }, { authorization: 'Bearer abc.def.ghi' }),
          deps(gm),
        )
      ).status,
    ).toBe(401);
    expect((await askRoute(ask({ question: 'Leads?' }), deps(caller))).status).toBe(403);
  });

  it('refuses a body it cannot read and a malformed key before any model call', async () => {
    const d = deps(gm);
    expect((await askRoute(ask('{not json'), d)).status).toBe(400);
    expect((await askRoute(ask({ question: '' }), d)).status).toBe(400);
    expect((await askRoute(ask({ question: 'x'.repeat(5000) }), d)).status).toBe(400);
    expect(
      (await askRoute(ask({ question: 'Leads?' }, { 'idempotency-key': 'not-a-uuid' }), d)).status,
    ).toBe(400);
    expect(d.transport.calls).toBe(0);
  });

  it('answers the day’s caps plainly before any model call or lookup, until midnight in India', async () => {
    const keyValue = memoryKeyValue();
    const now = new Date();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
    await keyValue.incrBy(
      personSpendKey(AGENT_DEFAULTS.ask.spendName, gm.id, day),
      AGENT_DEFAULTS.ask.personDailyCapPaise,
      60,
    );
    const d = { ...deps(gm, { keyValue }), now: () => now };
    const response = await askRoute(ask({ question: 'Leads?' }), d);
    const answer = await failure(response);
    expect(answer.status).toBe(429);
    expect(answer.body.error.details).toEqual({ reason: 'ask_person_cap_reached' });
    expect(answer.body.error.message).toBe(
      "You have reached today's limit for Ask the Business. You can ask again tomorrow.",
    );
    expect(response.headers.get('retry-after')).toBe(String(secondsToIstMidnight(now)));
    expect(d.transport.calls).toBe(0);
  });

  it('says plainly when no model is set up', async () => {
    const keyValue = memoryKeyValue();
    const provider = createAiProvider({
      claude: undefined,
      voyage: undefined,
      keyValue,
      logger: memoryLogger(),
    });
    const answer = await failure(
      await askRoute(ask({ question: 'Leads?' }), deps(gm, { provider })),
    );
    expect(answer).toMatchObject({
      status: 503,
      body: { error: { details: { reason: 'ask_unavailable' } } },
    });
  });

  it('streams each lookup, then the filtered answer with its sources, and answers a repeated key from its record', async () => {
    const d = deps(gm);
    const key = newId();
    const response = await askRoute(
      ask({ question: 'How many open leads are there?' }, { 'idempotency-key': key }),
      d,
    );
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    const events = await lines(response);
    expect(events[0]).toEqual({ type: 'lookup', lookup: 'pipeline_by_stage' });
    const last = events.at(-1);
    if (last?.type !== 'answer') throw new Error(`expected an answer, got ${JSON.stringify(last)}`);
    made.push(last.turn.conversation.id);
    expect(['answered', 'unsourced']).toContain(last.turn.message.outcome);
    expect(last.turn.message.unsourced).toBe(0);
    expect(last.sources.map((s) => s.id)).toEqual(last.turn.message.cited.map((s) => s.id));
    const calls = d.transport.calls;

    const again = await lines(
      await askRoute(
        ask({ question: 'How many open leads are there?' }, { 'idempotency-key': key }),
        d,
      ),
    );
    expect(again.at(-1)).toMatchObject({ type: 'answer', turn: last.turn });
    expect(d.transport.calls).toBe(calls);
  });

  it('ends the stream with an error line for a conversation that is not the person’s', async () => {
    const events = await lines(
      await askRoute(ask({ conversationId: newId(), question: 'And again?' }), deps(gm)),
    );
    expect(events).toEqual([
      { type: 'error', error: { code: 'not_found', reason: 'ask_conversation_missing' } },
    ]);
  });

  it('caps the questions one person sends in a minute', async () => {
    const d = deps(gm);
    const answers: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const response = await askRoute(ask({ conversationId: newId(), question: 'Again?' }), d);
      answers.push(response.status);
      await response.text();
    }
    expect(answers.slice(0, 6).every((s) => s === 200)).toBe(true);
    expect(answers[6]).toBe(429);
  });
});
