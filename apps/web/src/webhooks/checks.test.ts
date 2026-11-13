import { createHash, createHmac } from 'node:crypto';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { signedStatusCallbackUrl } from '../integrations/exotel/status-callback';
import {
  checkExotelIncoming,
  checkExotelStatus,
  checkGoogleKey,
  checkLiveKit,
  checkMetaSignature,
  metaChallenge,
} from './checks';

// Each provider's check (docs/03-roadmap-appendix/phase2.md §5.1), with low-entropy test secrets.

const bytes = (text: string) => new TextEncoder().encode(text);

describe('Meta signature', () => {
  const secret = 'meta app secret for the check test';
  const body = '{"object":"page","entry":[]}';
  const header = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('passes the HMAC of the exact bytes, in either case of hex', () => {
    expect(checkMetaSignature(bytes(body), header, secret)).toEqual({ ok: true });
    expect(
      checkMetaSignature(bytes(body), header.toUpperCase().replace('SHA256=', 'sha256='), secret),
    ).toEqual({ ok: true });
  });

  it('refuses a changed byte, another secret, a missing or malformed header', () => {
    expect(checkMetaSignature(bytes(`${body} `), header, secret)).toEqual({
      ok: false,
      problem: 'bad_signature',
    });
    expect(checkMetaSignature(bytes(body), header, 'another secret')).toEqual({
      ok: false,
      problem: 'bad_signature',
    });
    expect(checkMetaSignature(bytes(body), null, secret)).toEqual({
      ok: false,
      problem: 'unsigned',
    });
    expect(checkMetaSignature(bytes(body), 'sha1=abc', secret)).toEqual({
      ok: false,
      problem: 'bad_signature',
    });
  });

  it('answers the subscription challenge only for the verify phrase', () => {
    const params = (token: string, mode = 'subscribe') =>
      new URLSearchParams({
        'hub.mode': mode,
        'hub.verify_token': token,
        'hub.challenge': '1158201444',
      });
    expect(metaChallenge(params('our phrase'), 'our phrase')).toBe('1158201444');
    expect(metaChallenge(params('their phrase'), 'our phrase')).toBeUndefined();
    expect(metaChallenge(params('our phrase', 'unsubscribe'), 'our phrase')).toBeUndefined();
    expect(metaChallenge(params(''), '')).toBeUndefined();
  });
});

describe('Google lead form key', () => {
  const key = 'google form key for the check test';

  it('passes the form key and refuses another, or none', () => {
    expect(checkGoogleKey({ google_key: key }, key)).toEqual({ ok: true });
    expect(checkGoogleKey({ google_key: `${key}x` }, key)).toEqual({
      ok: false,
      problem: 'bad_key',
    });
    expect(checkGoogleKey({ lead_id: '1' }, key)).toEqual({ ok: false, problem: 'unsigned' });
    expect(checkGoogleKey('not json', key)).toEqual({ ok: false, problem: 'unsigned' });
  });
});

describe('Exotel', () => {
  const secret = 'exotel callback secret for the check test';
  const now = new Date('2026-11-13T06:00:00Z');
  const ref = '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a11';

  it('passes the status address the BOS signed, and answers its call reference', () => {
    const url = signedStatusCallbackUrl(
      'https://bos.test/api/v1/webhooks/exotel/call-status',
      ref,
      secret,
      now,
    );
    expect(checkExotelStatus(url, secret, now)).toEqual({ ok: true, ref });
  });

  it('refuses an address unsigned, changed, signed with another secret or expired', () => {
    const url = signedStatusCallbackUrl('https://bos.test/x', ref, secret, now);
    expect(checkExotelStatus('https://bos.test/x', secret, now)).toEqual({
      ok: false,
      problem: 'unsigned',
    });
    expect(checkExotelStatus(url.replace('8a11', '8a12'), secret, now)).toEqual({
      ok: false,
      problem: 'bad_signature',
    });
    expect(checkExotelStatus(url, 'another secret', now)).toEqual({
      ok: false,
      problem: 'bad_signature',
    });
    const later = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(checkExotelStatus(url, secret, later)).toEqual({ ok: false, problem: 'expired' });
  });

  it('passes the inbound secret path segment and refuses any other', () => {
    expect(
      checkExotelIncoming('inbound-path-for-the-check-test', 'inbound-path-for-the-check-test'),
    ).toEqual({ ok: true });
    expect(
      checkExotelIncoming('inbound-path-for-the-check-tesT', 'inbound-path-for-the-check-test'),
    ).toEqual({ ok: false, problem: 'bad_key' });
    expect(checkExotelIncoming('', 'inbound-path-for-the-check-test')).toEqual({
      ok: false,
      problem: 'unsigned',
    });
  });
});

describe('LiveKit token', () => {
  const apiKey = 'livekit key for the check test';
  const apiSecret = 'livekit secret for the check test';
  const now = new Date('2026-11-13T06:00:00Z');
  const body = '{"event":"room_started","id":"EV_1","createdAt":"1790500900"}';

  async function token(
    claims: Record<string, unknown>,
    secret = apiSecret,
    issuer = apiKey,
    at = now,
  ) {
    const iat = Math.floor(at.getTime() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setIssuedAt(iat)
      .setNotBefore(iat)
      .setExpirationTime(iat + 300)
      .sign(new TextEncoder().encode(secret));
  }
  const sha = createHash('sha256').update(body).digest('base64');

  it('passes a token from the API secret that carries the body’s SHA-256, with or without Bearer', async () => {
    const t = await token({ sha256: sha });
    expect(await checkLiveKit(bytes(body), t, apiKey, apiSecret, now)).toEqual({ ok: true });
    expect(await checkLiveKit(bytes(body), `Bearer ${t}`, apiKey, apiSecret, now)).toEqual({
      ok: true,
    });
  });

  it('refuses a changed body, another secret or issuer, an expired token and none', async () => {
    const t = await token({ sha256: sha });
    expect(await checkLiveKit(bytes(`${body} `), t, apiKey, apiSecret, now)).toEqual({
      ok: false,
      problem: 'bad_body_hash',
    });
    expect(
      await checkLiveKit(
        bytes(body),
        await token({ sha256: sha }, 'another secret'),
        apiKey,
        apiSecret,
        now,
      ),
    ).toEqual({ ok: false, problem: 'bad_token' });
    expect(
      await checkLiveKit(
        bytes(body),
        await token({ sha256: sha }, apiSecret, 'another key'),
        apiKey,
        apiSecret,
        now,
      ),
    ).toEqual({ ok: false, problem: 'bad_token' });
    const old = await token(
      { sha256: sha },
      apiSecret,
      apiKey,
      new Date(now.getTime() - 3_600_000),
    );
    expect(await checkLiveKit(bytes(body), old, apiKey, apiSecret, now)).toEqual({
      ok: false,
      problem: 'bad_token',
    });
    expect(await checkLiveKit(bytes(body), await token({}), apiKey, apiSecret, now)).toEqual({
      ok: false,
      problem: 'bad_body_hash',
    });
    expect(await checkLiveKit(bytes(body), null, apiKey, apiSecret, now)).toEqual({
      ok: false,
      problem: 'unsigned',
    });
  });
});
