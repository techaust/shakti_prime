import { describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => ({
  calls: [] as { endpoint: string; payload: string }[],
  status: undefined as number | undefined,
}));

vi.mock('web-push', () => ({
  sendNotification: (subscription: { endpoint: string }, payload: string) => {
    sent.calls.push({ endpoint: subscription.endpoint, payload });
    if (sent.status === undefined) return Promise.resolve({ statusCode: 201 });
    return Promise.reject(Object.assign(new Error('push refused'), { statusCode: sent.status }));
  },
}));

const { fakePushSender, pushSender, vapidConfig, webPushSender } = await import('./push');

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

  it('sends to a known push service, and reads 404 and 410 as a browser that is gone', async () => {
    const sender = webPushSender({ ...KEYS, subject: 'https://shakti.test' });
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    sent.status = undefined;
    expect(await sender.send(target(endpoint), message)).toBe('ok');
    expect(JSON.parse(sent.calls.at(-1)?.payload ?? '{}')).toEqual(message);
    for (const [status, outcome] of [
      [410, 'gone'],
      [404, 'gone'],
      [500, 'failed'],
      [429, 'failed'],
    ] as const) {
      sent.status = status;
      expect(await sender.send(target(endpoint), message)).toBe(outcome);
    }
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
