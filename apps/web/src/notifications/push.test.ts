import type * as WebPush from 'web-push';
import { describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({
  calls: [] as { endpoint: string; payload: string }[],
  /** A status makes the push service refuse with 4.0.0's `WebPushError`; an Error is thrown as is. */
  answer: undefined as number | Error | undefined,
  loaded: false,
}));

// web-push 4.0.0 is an ES module with named exports only (no default export). The stand-in keeps
// that shape and throws the package's own `WebPushError`, built as its sender builds it for a
// response outside 2xx, so the test reads the status from the error 4.0.0 really throws.
vi.mock('web-push', async (importOriginal) => {
  const actual = await importOriginal<typeof WebPush>();
  sent.loaded = true;
  return {
    WebPushError: actual.WebPushError,
    sendNotification: (subscription: { endpoint: string }, payload: string) => {
      sent.calls.push({ endpoint: subscription.endpoint, payload });
      const answer = sent.answer;
      if (answer === undefined) return Promise.resolve({ statusCode: 201, body: '', headers: {} });
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.reject(
        new actual.WebPushError(
          'Received unexpected response code',
          answer,
          {},
          '',
          subscription.endpoint,
        ),
      );
    },
  };
});

const { fakePushSender, pushSender, vapidConfig, webPushSender } = await import('./push');
const loadedOnImport = sent.loaded;

const KEYS = { publicKey: 'public-test-key', privateKey: 'private-test-key' };
const target = (endpoint: string) => ({ endpoint, p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) });
const message = {
  title: 'A call is due',
  body: 'Tap to open your calling queue.',
  url: '/calling',
  tag: 't',
};

describe('browser push (docs/03-roadmap-appendix/phase1.md §8.1)', () => {
  it('is off unless all three VAPID values are set, with a mailto or https subject', () => {
    expect(vapidConfig({})).toBeUndefined();
    expect(
      vapidConfig({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'owner' }),
    ).toBeUndefined();
    expect(
      vapidConfig({
        VAPID_PUBLIC_KEY: KEYS.publicKey,
        VAPID_PRIVATE_KEY: KEYS.privateKey,
        VAPID_SUBJECT: 'mailto:alerts@shakti.test',
      }),
    ).toEqual({ ...KEYS, subject: 'mailto:alerts@shakti.test' });
    expect(pushSender({})).toBeUndefined();
  });

  it('loads web-push only on the first send, not when the module is imported', async () => {
    expect(loadedOnImport).toBe(false);
    expect(
      pushSender({
        VAPID_PUBLIC_KEY: KEYS.publicKey,
        VAPID_PRIVATE_KEY: KEYS.privateKey,
        VAPID_SUBJECT: 'https://shakti.test',
      }),
    ).toBeDefined();
    sent.answer = undefined;
    const sender = webPushSender({ ...KEYS, subject: 'https://shakti.test' });
    expect(await sender.send(target('https://fcm.googleapis.com/fcm/send/first'), message)).toBe(
      'ok',
    );
    expect(sent.loaded).toBe(true);
  });

  it('sends to a known push service, and reads 404 and 410 as a browser that is gone', async () => {
    const sender = webPushSender({ ...KEYS, subject: 'https://shakti.test' });
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    sent.answer = undefined;
    expect(await sender.send(target(endpoint), message)).toBe('ok');
    expect(JSON.parse(sent.calls.at(-1)?.payload ?? '{}')).toEqual(message);
    for (const [status, outcome] of [
      [410, 'gone'],
      [404, 'gone'],
      [500, 'failed'],
      [429, 'failed'],
    ] as const) {
      sent.answer = status;
      expect(await sender.send(target(endpoint), message)).toBe(outcome);
    }
  });

  it("reads the status from web-push 4.0.0's own WebPushError", async () => {
    const { WebPushError } = await import('web-push');
    const refused = new WebPushError('Received unexpected response code', 410, {}, '', 'x');
    expect(refused).toBeInstanceOf(Error);
    expect(refused.statusCode).toBe(410);

    const sender = webPushSender({ ...KEYS, subject: 'mailto:alerts@shakti.test' });
    const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/abc';
    sent.answer = 410;
    expect(await sender.send(target(endpoint), message)).toBe('gone');
    sent.answer = 404;
    expect(await sender.send(target(endpoint), message)).toBe('gone');
    sent.answer = 500;
    expect(await sender.send(target(endpoint), message)).toBe('failed');
    // A timeout or a refused connection is a plain Error with no status: it failed, nothing more.
    sent.answer = new Error('Socket timeout');
    expect(await sender.send(target(endpoint), message)).toBe('failed');
    sent.answer = undefined;
  });

  it('never calls an address outside the push services, whatever the database holds', async () => {
    const sender = webPushSender({ ...KEYS, subject: 'https://shakti.test' });
    const before = sent.calls.length;
    expect(await sender.send(target('https://internal.example.org/admin'), message)).toBe('gone');
    expect(await sender.send(target('http://fcm.googleapis.com/fcm/send/x'), message)).toBe('gone');
    expect(sent.calls.length).toBe(before);
  });

  it('has a stand-in for tests that answers each address as told', async () => {
    const fake = fakePushSender({ 'https://web.push.apple.com/x': 'gone' });
    expect(await fake.send(target('https://web.push.apple.com/x'), message)).toBe('gone');
    expect(await fake.send(target('https://fcm.googleapis.com/y'), message)).toBe('ok');
    expect(fake.sent.map((s) => s.endpoint)).toEqual([
      'https://web.push.apple.com/x',
      'https://fcm.googleapis.com/y',
    ]);
  });
});
