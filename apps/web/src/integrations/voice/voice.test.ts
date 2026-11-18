import { AGENT_DEFAULTS } from '@shakti/domain';
import { hasDevanagari } from '@shakti/voice';
import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { stubFetch, urlOf } from '../test-fetch';
import { liveKitHttpBase, liveKitRooms, liveKitToken } from './livekit';
import { PRONUNCIATION_CHECKLIST } from './pronunciation-checklist';
import { DEFAULT_VOICE_SPIKE_MODEL, voiceClaudeConfig, VOICE_MODEL_SETTINGS } from './voice-model';

// Low-entropy phrases, so the secret scan never mistakes them for keys (CLAUDE.md).
const LIVEKIT = {
  url: 'wss://shakti-spike.livekit.test',
  apiKey: 'livekit-test-key',
  apiSecret: 'livekit-test-secret-livekit-test-secret',
};

describe('the voice model settings', () => {
  it('come from AGENT_DEFAULTS.voice, the one source', () => {
    expect(DEFAULT_VOICE_SPIKE_MODEL).toBe(AGENT_DEFAULTS.voice.model);
    expect(VOICE_MODEL_SETTINGS).toEqual({
      model: AGENT_DEFAULTS.voice.model,
      effort: AGENT_DEFAULTS.voice.effort,
      thinking: AGENT_DEFAULTS.voice.thinking,
      maxTokens: AGENT_DEFAULTS.voice.maxTokens,
    });
    expect(voiceClaudeConfig({ ANTHROPIC_API_KEY: 'anthropic-test-key' })?.model).toBe(
      'claude-sonnet-5-5',
    );
    expect(() =>
      voiceClaudeConfig({ ANTHROPIC_API_KEY: 'anthropic-test-key', VOICE_SPIKE_MODEL: 'nope' }),
    ).toThrow(/does not list/);
  });
});

describe('LiveKit', () => {
  it('signs access tokens LiveKit can verify with the API secret', async () => {
    const token = await liveKitToken(LIVEKIT, 'user-1', { roomJoin: true, room: 'r' });
    const { payload } = await jwtVerify(token, new TextEncoder().encode(LIVEKIT.apiSecret), {
      issuer: 'livekit-test-key',
      subject: 'user-1',
    });
    expect(payload.video).toEqual({ roomJoin: true, room: 'r' });
  });

  it('calls the room service over HTTPS with a room-create grant', async () => {
    const fetchImpl = stubFetch(() => Response.json({ name: 'spike' }));
    await liveKitRooms(LIVEKIT, { fetch: fetchImpl, timeoutMs: 1_000 }).createRoom('spike');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(url)).toBe(
      'https://shakti-spike.livekit.test/twirp/livekit.RoomService/CreateRoom',
    );
    const bearer = new Headers(init?.headers).get('authorization')?.slice('Bearer '.length) ?? '';
    const { payload } = await jwtVerify(bearer, new TextEncoder().encode(LIVEKIT.apiSecret));
    expect(payload.video).toEqual({ roomCreate: true });
    expect(liveKitHttpBase('wss://a.livekit.cloud/')).toBe('https://a.livekit.cloud');
  });
});

describe('the pronunciation checklist', () => {
  it('is Roman script only, with unique ids and something to listen for', () => {
    const ids = PRONUNCIATION_CHECKLIST.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const line of PRONUNCIATION_CHECKLIST) {
      expect(hasDevanagari(line.text)).toBe(false);
      expect(line.listenFor.length).toBeGreaterThan(10);
    }
  });
});
