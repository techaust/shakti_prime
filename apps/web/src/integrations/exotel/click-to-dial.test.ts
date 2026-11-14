import { ClickToDialRefused, ClickToDialUncertain, type ClickToDialRequest } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../http';
import { bodyOf, stubFetch, urlOf } from '../test-fetch';
import { clickToDial, exotelClickToDial, simulatedClickToDial } from './click-to-dial';
import { exotelClient, isExotelRecordingUrl } from './client';
import connectResponse from './fixtures/connect-response.json';
import { verifyStatusCallbackUrl } from './status-callback';

// Low-entropy phrases, so the secret scan never mistakes them for keys (CLAUDE.md).
const CONFIG = {
  accountSid: 'shaktiprime1',
  apiKey: 'exotel-test-key',
  apiToken: 'exotel-test-token',
  subdomain: 'api.in.exotel.com',
};
const CALLBACK = { base: 'https://bos.shakti.test', secret: 'exotel-callback-test-secret' };
const ELEVEN_AM_IST = new Date('2026-09-28T05:30:00Z');
const REF = '01931f6e-8a2b-7c3d-9e4f-5a6b7c8d9e0f';

const request: ClickToDialRequest = {
  ref: REF,
  agentNumber: '+919000000001',
  customerNumber: '+919000000002',
  callerId: '+911400000000',
  purpose: 'promotional',
  hasRecordedConsent: false,
  onDnd: false,
  callConsentWithdrawn: false,
  record: true,
};

function port(fetchImpl: typeof fetch) {
  const client = exotelClient(CONFIG, {
    fetch: fetchImpl,
    timeoutMs: 1_000,
    now: () => ELEVEN_AM_IST,
  });
  return exotelClickToDial(client, CALLBACK, () => ELEVEN_AM_IST);
}

describe('Exotel behind the dial port', () => {
  it('rings the caller, then the customer, on the signed status address, unrecorded', async () => {
    const fetchImpl = stubFetch(() => Response.json(connectResponse));
    expect(await port(fetchImpl).place(request)).toEqual({ sid: connectResponse.Call.Sid });
    const form = Object.fromEntries(new URLSearchParams(bodyOf(fetchImpl.mock.calls[0]?.[1])));
    expect(form).toMatchObject({
      From: '+919000000001',
      To: '+919000000002',
      CallerId: '+911400000000',
      // No flow plays the recording notice before the caller is joined (design §6.3).
      Record: 'false',
      CustomField: REF,
      TimeLimit: '14400',
    });
    const status = form.StatusCallback ?? '';
    expect(status.startsWith('https://bos.shakti.test/api/v1/webhooks/exotel/call-status?')).toBe(
      true,
    );
    expect(verifyStatusCallbackUrl(status, CALLBACK.secret, ELEVEN_AM_IST)).toEqual({
      ok: true,
      ref: REF,
    });
  });

  it("answers a refusal by the rules or by Exotel as refused, and a timeout or Exotel's 5xx as uncertain", async () => {
    const never = stubFetch(() => Response.json(connectResponse));
    await expect(port(never).place({ ...request, purpose: 'service' })).rejects.toBeInstanceOf(
      ClickToDialRefused,
    );
    expect(never).not.toHaveBeenCalled();
    await expect(
      port(stubFetch(() => Response.json({}, { status: 400 }))).place(request),
    ).rejects.toBeInstanceOf(ClickToDialRefused);
    await expect(
      port(stubFetch(() => Response.json({}, { status: 503 }))).place(request),
    ).rejects.toBeInstanceOf(ClickToDialUncertain);
    const slow = vi.fn<typeof fetch>(() =>
      Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
    );
    await expect(port(slow).place(request)).rejects.toBeInstanceOf(ClickToDialUncertain);
  });

  it('is Exotel with an account, the simulated provider off a hosted runtime, none on one', () => {
    const report = () => Promise.resolve();
    const env = {
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://bos.shakti.test',
      BOS_ENVIRONMENT: 'production',
    } as NodeJS.ProcessEnv;
    expect(clickToDial(report, { env })).toBeUndefined();
    expect(
      clickToDial(report, {
        env: {
          ...env,
          EXOTEL_ACCOUNT_SID: 'shaktiprime1',
          EXOTEL_API_KEY: 'exotel-test-key',
          EXOTEL_API_TOKEN: 'exotel-test-token',
          EXOTEL_CALLBACK_SECRET: 'exotel-callback-test-secret',
        },
      }),
    ).toBeDefined();
    expect(clickToDial(report, { env: { NODE_ENV: 'test' } })).toBeDefined();
  });
});

describe('the simulated provider', () => {
  it('reports the answer and then the end, as Exotel would', async () => {
    vi.useFakeTimers();
    try {
      const reports: Record<string, unknown>[] = [];
      const sim = simulatedClickToDial(
        (r) => {
          reports.push(r);
          return Promise.resolve();
        },
        { answerMs: 1_000, endMs: 3_000, now: () => ELEVEN_AM_IST },
      );
      const { sid } = await sim.place(request);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(reports.map((r) => [r.Status, r.CallSid, r.bos_ref])).toEqual([
        ['in-progress', sid, REF],
        ['completed', sid, REF],
      ]);
      expect(reports[1]).toMatchObject({ ConversationDuration: '2', RecordingUrl: '' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a recording's copy", () => {
  const client = (fetchImpl: typeof fetch) =>
    exotelClient(CONFIG, { fetch: fetchImpl, timeoutMs: 1_000, now: () => ELEVEN_AM_IST });
  const mp3 = (status = 200, headers: Record<string, string> = {}) =>
    new Response(status === 200 ? new Uint8Array([1, 2, 3]) : null, {
      status,
      headers: { 'content-type': 'audio/mpeg', ...headers },
    });

  it("is taken only from Exotel's own hosts and bucket", () => {
    expect(isExotelRecordingUrl('https://recordings.exotel.com/a/b.mp3')).toBe(true);
    expect(
      isExotelRecordingUrl('https://s3-ap-southeast-1.amazonaws.com/exotelrecordings/a/b.mp3'),
    ).toBe(true);
    for (const url of [
      'http://recordings.exotel.com/a.mp3',
      'https://exotel.com.evil.test/a.mp3',
      'https://s3-ap-southeast-1.amazonaws.com/other-bucket/a.mp3',
      'https://user:pw@recordings.exotel.com/a.mp3',
      'https://recordings.exotel.com:8443/a.mp3',
      'https://169.254.169.254/latest/meta-data',
      'not a link',
    ]) {
      expect({ url, ok: isExotelRecordingUrl(url) }).toEqual({ url, ok: false });
    }
  });

  it("sends the account's key to Exotel alone and follows one redirect to its bucket", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: 'https://s3-ap-southeast-1.amazonaws.com/exotelrecordings/shaktiprime1/a.mp3',
          },
        }),
      )
      .mockResolvedValueOnce(mp3());
    const recording = await client(fetchImpl).fetchRecording(
      'https://recordings.exotel.com/shaktiprime1/a.mp3',
      10,
    );
    expect(recording).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg' });
    const [first, second] = fetchImpl.mock.calls;
    expect(new Headers(first?.[1]?.headers).get('authorization')).not.toBeNull();
    expect(urlOf(second?.[0])).toContain('amazonaws.com/exotelrecordings/');
    expect(new Headers(second?.[1]?.headers).get('authorization')).toBeNull();
  });

  it('refuses a redirect elsewhere, a file too large and one that is not audio', async () => {
    const away = stubFetch(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.test/a.mp3' } }),
    );
    await expect(
      client(away).fetchRecording('https://recordings.exotel.com/a.mp3', 10),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(away).toHaveBeenCalledTimes(1);
    await expect(
      client(stubFetch(() => mp3())).fetchRecording('https://recordings.exotel.com/a.mp3', 2),
    ).rejects.toBeInstanceOf(ProviderError);
    await expect(
      client(
        stubFetch(() => new Response('<html>', { headers: { 'content-type': 'text/html' } })),
      ).fetchRecording('https://recordings.exotel.com/a', 100),
    ).rejects.toBeInstanceOf(ProviderError);
    await expect(
      client(stubFetch(() => mp3())).fetchRecording('https://evil.test/a.mp3', 100),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
