import { ProviderError, type ProviderName } from '../http';

/**
 * WebSocket plumbing for the streaming speech adapters, without a vendor SDK: Node's own
 * `WebSocket` (Node 22 and later), which, unlike a browser's, takes headers for the vendor's key.
 * The adapters take an `OpenSocket`, so the tests and the benchmark's replays hand them recorded
 * sessions instead (`recorded.ts`). Like the HTTP wrappers, nothing here logs a frame.
 */

export interface VendorSocket {
  send(text: string): void;
  close(): void;
  /** The vendor's text frames in order: read once; ends when the socket closes, throws on a failure. */
  readonly messages: AsyncIterable<string>;
}

export type OpenSocket = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => Promise<VendorSocket>;

/** A first-in, first-out channel read by one `for await`; `fail()` ends it with an error. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiting: ((result: IteratorResult<T>) => void)[] = [];
  private readonly rejecting: ((error: unknown) => void)[] = [];
  private done = false;
  private error: unknown = undefined;

  push(item: T): void {
    if (this.done) return;
    const resolve = this.waiting.shift();
    this.rejecting.shift();
    if (resolve === undefined) this.items.push(item);
    else resolve({ value: item, done: false });
  }

  close(): void {
    if (this.done) return;
    this.done = true;
    this.rejecting.length = 0;
    for (const resolve of this.waiting.splice(0)) resolve({ value: undefined, done: true });
  }

  fail(error: unknown): void {
    if (this.done) return;
    this.done = true;
    this.error = error;
    this.waiting.length = 0;
    for (const reject of this.rejecting.splice(0)) reject(error);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.done) {
          if (this.error === undefined) return Promise.resolve({ value: undefined, done: true });
          return Promise.reject(
            this.error instanceof Error ? this.error : new Error('the stream failed'),
          );
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.waiting.push(resolve);
          this.rejecting.push(reject);
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

/** Node's `WebSocket` accepts `{ headers }` as its second argument; the DOM typing does not say so. */
type NodeWebSocket = new (
  url: string,
  init: { headers: Readonly<Record<string, string>> },
) => WebSocket;

/**
 * Opens a socket to the vendor within `openTimeoutMs`. A close the caller did not ask for, other
 * than a normal one, ends `messages` with a `network` error carrying the close code.
 */
export function webSocketOpener(provider: ProviderName, openTimeoutMs: number): OpenSocket {
  return (url, headers) =>
    new Promise<VendorSocket>((resolve, reject) => {
      const queue = new AsyncQueue<string>();
      const decoder = new TextDecoder();
      let opened = false;
      let closedByUs = false;
      let ws: WebSocket;
      try {
        ws = new (WebSocket as unknown as NodeWebSocket)(url, { headers });
      } catch (cause) {
        reject(new ProviderError(provider, 'network', { cause }));
        return;
      }
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        closedByUs = true;
        ws.close();
        reject(new ProviderError(provider, 'timeout'));
      }, openTimeoutMs);

      ws.onopen = () => {
        clearTimeout(timer);
        opened = true;
        resolve({
          send: (text) => {
            ws.send(text);
          },
          close: () => {
            closedByUs = true;
            queue.close();
            ws.close(1000);
          },
          messages: queue,
        });
      };
      ws.onmessage = (event: MessageEvent<unknown>) => {
        const { data } = event;
        if (typeof data === 'string') queue.push(data);
        else if (data instanceof ArrayBuffer) queue.push(decoder.decode(data));
      };
      ws.onerror = () => {
        if (!opened) {
          clearTimeout(timer);
          reject(new ProviderError(provider, 'network'));
        }
      };
      ws.onclose = (event: CloseEvent) => {
        clearTimeout(timer);
        if (!opened) {
          reject(
            new ProviderError(provider, 'network', { vendorCode: `close_${String(event.code)}` }),
          );
        } else if (closedByUs || event.code === 1000) {
          queue.close();
        } else {
          queue.fail(
            new ProviderError(provider, 'network', { vendorCode: `close_${String(event.code)}` }),
          );
        }
      };
    });
}
