import { describe, expect, it } from 'vitest';
import { agentCredentials } from './config';

// The worker's LiveKit key is its own (SECURITY §3.4): the BOS's key, which checks LiveKit's
// webhooks, never reaches it, so a leaked worker cannot forge an event the BOS accepts.

const URL = 'wss://shakti-test.livekit.cloud';

describe("the worker's LiveKit credentials", () => {
  it('are its own agent key', () => {
    expect(
      agentCredentials({
        LIVEKIT_URL: URL,
        LIVEKIT_AGENT_API_KEY: 'APIworker',
        LIVEKIT_AGENT_API_SECRET: 'the worker secret',
      }),
    ).toEqual({ wsURL: URL, apiKey: 'APIworker', apiSecret: 'the worker secret' });
  });

  it("refuse to start with the BOS's key in the environment, by either of its names", () => {
    const own = {
      LIVEKIT_URL: URL,
      LIVEKIT_AGENT_API_KEY: 'APIworker',
      LIVEKIT_AGENT_API_SECRET: 'the worker secret',
    };
    expect(() => agentCredentials({ ...own, LIVEKIT_API_KEY: 'APIbos' })).toThrow(/BOS/);
    expect(() => agentCredentials({ ...own, LIVEKIT_API_SECRET: 'the bos secret' })).toThrow(/BOS/);
  });

  it('refuse to start without the agent key', () => {
    expect(() => agentCredentials({ LIVEKIT_URL: URL })).toThrow(/must be set/);
    expect(() =>
      agentCredentials({ LIVEKIT_API_KEY: 'APIbos', LIVEKIT_API_SECRET: 'the bos secret' }),
    ).toThrow();
  });
});
