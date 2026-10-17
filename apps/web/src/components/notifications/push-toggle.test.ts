import { describe, expect, it, vi } from 'vitest';
import { isOwnSubscription } from './push-toggle';

vi.mock('../../actions/notifications', () => ({
  pushBrowser: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/browser-one',
} as PushSubscription;

describe('the push toggle reads alerts as on only for the person signed in (#168 review L4)', () => {
  it('reads a browser the server keeps for the person as theirs, asking by its address', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: true, data: { subscribed: true } });
    expect(await isOwnSubscription(subscription, ask)).toBe(true);
    expect(ask).toHaveBeenCalledWith({ endpoint: subscription.endpoint });
  });

  it('reads a browser another person turned alerts on for as not theirs', async () => {
    const ask = vi.fn().mockResolvedValue({ ok: true, data: { subscribed: false } });
    expect(await isOwnSubscription(subscription, ask)).toBe(false);
  });

  it('reads alerts as off when the answer does not come', async () => {
    expect(
      await isOwnSubscription(subscription, vi.fn().mockResolvedValue({ ok: false, error: 'x' })),
    ).toBe(false);
    expect(
      await isOwnSubscription(subscription, vi.fn().mockRejectedValue(new Error('offline'))),
    ).toBe(false);
  });
});
