import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../csp';
import { realtimeConnectOrigins, screenPopTransport } from './transport';

const REALTIME = {
  SCREEN_POP_TRANSPORT: 'realtime',
  SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co/',
  SUPABASE_ANON_KEY: 'sb_publishable_screen_pop',
  BOS_JWT_CURRENT_KEY: '{"kty":"EC"}',
};

describe('the screen-pop transport, one setting', () => {
  it('polls unless the setting says Realtime and Realtime is set up', () => {
    expect(screenPopTransport({})).toEqual({ kind: 'poll' });
    expect(screenPopTransport({ ...REALTIME, SCREEN_POP_TRANSPORT: 'poll' })).toEqual({
      kind: 'poll',
    });
    for (const missing of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'BOS_JWT_CURRENT_KEY'] as const) {
      expect(screenPopTransport({ ...REALTIME, [missing]: '' })).toEqual({ kind: 'poll' });
    }
    expect(screenPopTransport({ ...REALTIME, SUPABASE_URL: 'http://plain.example.com' })).toEqual({
      kind: 'poll',
    });
    expect(screenPopTransport(REALTIME)).toEqual({
      kind: 'realtime',
      url: 'https://abcdefghijklmnop.supabase.co',
      key: 'sb_publishable_screen_pop',
    });
  });

  it('lets a page open the Realtime socket only when Realtime is the transport', () => {
    expect(realtimeConnectOrigins({})).toEqual([]);
    const origins = realtimeConnectOrigins(REALTIME);
    expect(origins).toEqual(['wss://abcdefghijklmnop.supabase.co']);
    expect(contentSecurityPolicy('n', false, undefined, [], origins)).toContain(
      "connect-src 'self' https://challenges.cloudflare.com wss://abcdefghijklmnop.supabase.co;",
    );
  });
});
