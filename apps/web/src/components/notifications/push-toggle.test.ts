import { describe, expect, it, vi } from 'vitest';
import { releaseOthersSubscription, subscriptionOwner } from './push-toggle';

vi.mock('../../actions/notifications', () => ({
  pushBrowser: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

const endpoint = 'https://fcm.googleapis.com/fcm/send/browser-one';
const subscription = { endpoint } as PushSubscription;

function browserSubscription() {
  const unsubscribe = vi.fn().mockResolvedValue(true);
  return { subscription: { endpoint, unsubscribe } as unknown as PushSubscription, unsubscribe };
}

const answers = {
  mine: () => vi.fn().mockResolvedValue({ ok: true, data: { subscribed: true } }),
  other: () => vi.fn().mockResolvedValue({ ok: true, data: { subscribed: false } }),
  failed: () => vi.fn().mockResolvedValue({ ok: false, error: 'internal' }),
  offline: () => vi.fn().mockRejectedValue(new Error('offline')),
};

describe('the push toggle reads alerts as on only for the person signed in (#168 review L4)', () => {
  it('reads a browser the server keeps for the person as theirs, asking by its address', async () => {
    const ask = answers.mine();
    expect(await subscriptionOwner(subscription, ask)).toBe('mine');
    expect(ask).toHaveBeenCalledWith({ endpoint });
  });

  it('reads a browser another person turned alerts on for as theirs, not the person’s', async () => {
    expect(await subscriptionOwner(subscription, answers.other())).toBe('other');
  });

  it('reads the owner as unknown when the answer does not come', async () => {
    expect(await subscriptionOwner(subscription, answers.failed())).toBe('unknown');
    expect(await subscriptionOwner(subscription, answers.offline())).toBe('unknown');
  });
});

describe('Turn on alerts drops only another person’s subscription (#168 review L4)', () => {
  it('drops a subscription another person made on this browser', async () => {
    const { subscription: theirs, unsubscribe } = browserSubscription();
    expect(await releaseOthersSubscription(theirs, answers.other())).toEqual({ ok: true });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps the person’s own subscription', async () => {
    const { subscription: own, unsubscribe } = browserSubscription();
    expect(await releaseOthersSubscription(own, answers.mine())).toEqual({ ok: true });
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it('keeps the subscription and answers the failure when the owner is unknown', async () => {
    for (const ask of [answers.failed(), answers.offline()]) {
      const { subscription: unknown, unsubscribe } = browserSubscription();
      expect(await releaseOthersSubscription(unknown, ask)).toEqual({
        ok: false,
        error: 'internal',
      });
      expect(unsubscribe).not.toHaveBeenCalled();
    }
  });

  it('asks nothing when the browser holds no subscription', async () => {
    const ask = answers.mine();
    expect(await releaseOthersSubscription(null, ask)).toEqual({ ok: true });
    expect(ask).not.toHaveBeenCalled();
  });
});
