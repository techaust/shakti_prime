import { describe, expect, it } from 'vitest';
import { ModelCallError } from './transport';
import { anthropicTransport, voyageTransport } from './vendor-transports';

// The vendor transports against recorded answers through a stand-in `fetch`: no network.

const signal = () => AbortSignal.timeout(5_000);

function respond(status: number, body: unknown): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

const MESSAGE = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5-20251001',
  content: [{ type: 'text', text: '{"propose":true}' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    input_tokens: 120,
    output_tokens: 30,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: 0,
  },
};

const REQUEST = { model: MESSAGE.model, system: 's', user: 'u', maxTokens: 100 };

describe('anthropicTransport', () => {
  it('reads the text, the tokens and how it stopped', async () => {
    const transport = anthropicTransport('test phrase', { fetch: respond(200, MESSAGE) });
    await expect(transport.complete(REQUEST, signal())).resolves.toEqual({
      text: '{"propose":true}',
      usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 900, cacheWriteTokens: 0 },
      stopped: 'finished',
    });
  });

  it('sends a document and a picture before the question', async () => {
    let sent: unknown;
    const transport = anthropicTransport('test phrase', {
      fetch: (_url, init) => {
        sent = JSON.parse(typeof init?.body === 'string' ? init.body : '');
        return Promise.resolve(
          new Response(JSON.stringify(MESSAGE), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      },
    });
    await transport.complete(
      {
        ...REQUEST,
        documents: [
          { mediaType: 'application/pdf', bytes: new Uint8Array([1, 2]) },
          { mediaType: 'image/jpeg', bytes: new Uint8Array([3]) },
        ],
      },
      signal(),
    );
    expect(sent).toMatchObject({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: 'AQI=' },
            },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'Aw==' } },
            { type: 'text', text: 'u' },
          ],
        },
      ],
    });
  });

  it('turns a refusal and a vendor error into its own terms', async () => {
    const refused = anthropicTransport('test phrase', {
      fetch: respond(200, { ...MESSAGE, stop_reason: 'refusal' }),
    });
    await expect(refused.complete(REQUEST, signal())).resolves.toMatchObject({
      stopped: 'refused',
    });
    const overloaded = anthropicTransport('test phrase', {
      fetch: respond(529, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }),
    });
    const error = await overloaded.complete(REQUEST, signal()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelCallError);
    expect(error).toMatchObject({ failure: 'http', status: 529, retryable: true });
  });
});

describe('voyageTransport', () => {
  it('reads 1,024 numbers per text and the tokens', async () => {
    const vector = Array.from({ length: 1024 }, () => 0.5);
    const transport = voyageTransport(
      'test phrase',
      respond(200, { data: [{ embedding: vector, index: 0 }], usage: { total_tokens: 7 } }),
    );
    await expect(
      transport.embed({ model: 'voyage-3.5', texts: ['pump'], inputType: 'document' }, signal()),
    ).resolves.toEqual({ vectors: [vector], tokens: 7 });
  });

  it('refuses an answer of the wrong shape, and passes the status on', async () => {
    const short = voyageTransport(
      'test phrase',
      respond(200, { data: [{ embedding: [1, 2], index: 0 }], usage: { total_tokens: 1 } }),
    );
    await expect(
      short.embed({ model: 'voyage-3.5', texts: ['a'], inputType: 'query' }, signal()),
    ).rejects.toMatchObject({ failure: 'invalid_response' });
    const limited = voyageTransport('test phrase', respond(429, {}));
    await expect(
      limited.embed({ model: 'voyage-3.5', texts: ['a'], inputType: 'query' }, signal()),
    ).rejects.toMatchObject({ failure: 'http', status: 429, retryable: true });
  });
});
