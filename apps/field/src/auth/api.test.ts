import { createApi } from './api';
import { tokenPair } from '../test/fake-api';

describe('the API client', () => {
  it('sends the app version on every call and the bearer where it has one', async () => {
    const fetchImpl = jest.fn(() =>
      Promise.resolve(Response.json(tokenPair(1))),
    ) as unknown as typeof fetch;
    const api = createApi(fetchImpl);
    const answer = await api.refresh(
      tokenPair(1).refreshToken,
      '6f1c2a4e-8b3d-4c5a-9e7f-0a1b2c3d4e5f',
    );
    expect(answer).toEqual({ ok: true, data: tokenPair(1) });
    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://bos.test/api/v1/auth/mobile/refresh');
    expect(init.headers).toMatchObject({
      'x-app-version': '1.0.0',
      'content-type': 'application/json',
    });
    await api.me(tokenPair(1).accessToken);
    const [, meInit] = (fetchImpl as unknown as jest.Mock).mock.calls[1] as [string, RequestInit];
    expect(meInit.headers).toMatchObject({ authorization: `Bearer ${tokenPair(1).accessToken}` });
  });

  it('answers the server’s reason, the code without one, and offline when nothing answered', async () => {
    const refusal = (body: unknown, status: number) =>
      createApi(() => Promise.resolve(Response.json(body, { status })));
    expect(
      await refusal(
        {
          error: {
            code: 'unauthorized',
            message: 'x',
            details: { reason: 'device_revoked' },
            requestId: 'r',
          },
        },
        401,
      ).me('t'),
    ).toEqual({ ok: false, reason: 'device_revoked', status: 401 });
    expect(
      await refusal({ error: { code: 'rate_limited', message: 'x', requestId: 'r' } }, 429).me('t'),
    ).toEqual({
      ok: false,
      reason: 'rate_limited',
      status: 429,
    });
    const down = createApi(() => Promise.reject(new TypeError('Network request failed')));
    expect(await down.me('t')).toEqual({ ok: false, reason: 'offline' });
  });
});
