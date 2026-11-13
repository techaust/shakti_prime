import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { systemClock } from './ports';
import {
  recordingFetch,
  recordingSockets,
  replayFetch,
  replaySockets,
  ReplayClock,
} from './recorded';
import { AsyncQueue, webSocketOpener } from './socket';

const servers: Server[] = [];
/** Upgraded connections leave the server's own list, so they are kept here to be ended. */
const connections: Socket[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.destroy();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((done) => {
          server.close(done);
        }),
    ),
  );
});

/** A server frame: unmasked, payload under 126 bytes. */
function frame(opcode: number, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
}

function closeFrame(code: number): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code);
  return frame(0x8, payload);
}

/**
 * The least WebSocket server the opener needs: it accepts the upgrade (unless told to hang), keeps
 * the headers it saw, then plays `script` on the socket.
 */
function server(
  script: (socket: Socket) => void,
  options: { hang?: boolean } = {},
): Promise<{ url: string; headers: () => Record<string, unknown> }> {
  let seen: Record<string, unknown> = {};
  const http = createServer();
  servers.push(http);
  http.on('connection', (connection: Socket) => connections.push(connection));
  http.on('upgrade', (request, socket: Socket) => {
    seen = { ...request.headers };
    if (options.hang === true) return;
    const accept = createHash('sha1')
      .update(`${String(request.headers['sec-websocket-key'])}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    script(socket);
  });
  return new Promise((resolve) => {
    http.listen(0, '127.0.0.1', () => {
      const { port } = http.address() as AddressInfo;
      resolve({ url: `ws://127.0.0.1:${String(port)}/stream`, headers: () => seen });
    });
  });
}

async function readAll(messages: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const message of messages) out.push(message);
  return out;
}

describe('the WebSocket opener', () => {
  it('sends the key as a header and hands on the vendor frames until a normal close', async () => {
    const live = await server((socket) => {
      socket.write(frame(0x1, Buffer.from('{"type":"events"}')));
      socket.write(frame(0x2, Buffer.from('{"type":"data"}')));
      // A server ends its side after its close frame.
      socket.end(closeFrame(1000));
    });
    const socket = await webSocketOpener('sarvam', 2_000)(live.url, {
      'api-subscription-key': 'sarvam-test-key',
    });
    expect(await readAll(socket.messages)).toEqual(['{"type":"events"}', '{"type":"data"}']);
    expect(live.headers()['api-subscription-key']).toBe('sarvam-test-key');
  });

  it('fails the frames on a close the caller did not ask for', async () => {
    const live = await server((socket) => {
      socket.end(closeFrame(1011));
    });
    const socket = await webSocketOpener('sarvam', 2_000)(live.url, {});
    await expect(readAll(socket.messages)).rejects.toMatchObject({
      provider: 'sarvam',
      failure: 'network',
      vendorCode: 'close_1011',
    });
  });

  it('times out an upgrade that never comes, and fails a refused connection', async () => {
    const hung = await server(() => undefined, { hang: true });
    await expect(webSocketOpener('sarvam', 50)(hung.url, {})).rejects.toMatchObject({
      failure: 'timeout',
    });
    await expect(
      webSocketOpener('sarvam', 2_000)('ws://127.0.0.1:1/stream', {}),
    ).rejects.toMatchObject({ failure: 'network' });
  });
});

describe('the frame queue', () => {
  it('hands on items in order, then ends or fails', async () => {
    const queue = new AsyncQueue<string>();
    queue.push('a');
    const reading = readAll(queue);
    queue.push('b');
    queue.close();
    queue.push('c');
    expect(await reading).toEqual(['a', 'b']);
    const failing = new AsyncQueue<string>();
    const failed = readAll(failing);
    failing.fail(new Error('gone'));
    await expect(failed).rejects.toThrow('gone');
  });
});

describe('recording a live session', () => {
  it('keeps socket frames timed from the first send, ready to replay', async () => {
    const clock = new ReplayClock();
    const source = replaySockets(
      [
        {
          source: 'written',
          note: 'n',
          frames: [
            { atMs: 120, data: { type: 'audio' } },
            { atMs: 150, text: 'not json' },
          ],
        },
      ],
      clock,
    );
    const recorder = recordingSockets(source.open, clock, 'recorded in a test');
    const socket = await recorder.open('wss://x', {});
    socket.send('{"type":"config"}');
    expect(await readAll(socket.messages)).toEqual(['{"type":"audio"}', 'not json']);
    expect(recorder.sessions).toEqual([
      {
        source: 'recorded',
        note: 'recorded in a test',
        frames: [
          { atMs: 120, data: { type: 'audio' } },
          { atMs: 150, text: 'not json' },
        ],
      },
    ]);
  });

  it('keeps a streamed body chunk by chunk, timed from the call', async () => {
    const clock = new ReplayClock();
    const source = replayFetch(
      [
        {
          source: 'written',
          note: 'n',
          frames: [
            { atMs: 300, text: 'event: a\n' },
            { atMs: 450, text: 'data: {}\n\n' },
          ],
        },
      ],
      clock,
    );
    const recorder = recordingFetch(source.fetch, clock, 'recorded in a test');
    const response = await recorder.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      body: '{"stream":true}',
    });
    expect(await response.text()).toBe('event: a\ndata: {}\n\n');
    expect(recorder.sessions[0]?.frames).toEqual([
      { atMs: 300, text: 'event: a\n' },
      { atMs: 450, text: 'data: {}\n\n' },
    ]);
    expect(source.requests).toEqual([
      { url: 'https://api.anthropic.com/v1/messages', body: { stream: true } },
    ]);
  });

  it('times live frames on the system clock', () => {
    expect(systemClock.now()).toBeGreaterThan(0);
  });
});
