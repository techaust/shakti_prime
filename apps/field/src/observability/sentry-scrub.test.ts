import { IDENTITY_KEYS } from '@shakti/contracts/masking';
import { scrubBreadcrumb, scrubEvent, scrubFields } from './sentry-scrub';

const JWT = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXNoYXBl';

describe('what the field app sends to Sentry', () => {
  it('drops tokens, the PIN, codes and the installation id, and scrubs text', () => {
    const event = scrubEvent({
      message: `refresh failed for rakesh.meena@shaktisupreme.in with Bearer ${JWT}`,
      request: {
        method: 'POST',
        url: 'https://shaktiprime.com/api/v1/auth/mobile/refresh?token=abc',
        headers: { authorization: `Bearer ${JWT}` },
        data: { refreshToken: 'r'.repeat(43) },
      },
      user: { id: '01a21d7b-ba63-77bb-afdc-c19e89ace56a', email: 'rakesh.meena@shaktisupreme.in' },
      tags: { phone: '9876543210' },
      extra: {
        accessToken: JWT,
        refresh_token: 'r'.repeat(43),
        pin: '2468',
        totpCode: '123456',
        deviceId: '6f1c2a4e-8b3d-4c5a-9e7f-0a1b2c3d4e5f',
        customer: 'Call Ramesh on 9876543210, Aadhaar 2345 6789 0123',
        code: 'device_revoked',
      },
      contexts: { device: { name: 'Rakesh ka phone', model: 'Galaxy M14' } },
      exception: {
        values: [
          {
            value: `token ${JWT} refused`,
            stacktrace: { frames: [{ filename: 'session.ts', vars: { token: JWT } }] },
          },
        ],
      },
      breadcrumbs: [
        { message: 'fetch https://shaktiprime.com/api/v1/me?x=1', data: { url: '/me?x=1' } },
      ],
    });
    const text = JSON.stringify(event);
    for (const secret of [JWT, 'r'.repeat(43), '2468', '123456', '6f1c2a4e', 'rakesh.meena']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('2345 6789 0123');
    expect(text).not.toContain('Rakesh ka phone');
    expect(event.request).toEqual({
      method: 'POST',
      url: 'https://shaktiprime.com/api/v1/auth/mobile/refresh',
    });
    expect(event.user).toEqual({ id: '01a21d7b-ba63-77bb-afdc-c19e89ace56a' });
    expect('tags' in event).toBe(false);
    expect(event.extra).toMatchObject({ code: 'device_revoked' });
    expect(event.contexts).toEqual({ device: { model: 'Galaxy M14' } });
  });

  it('scrubs a breadcrumb’s message and data alike', () => {
    const crumb = scrubBreadcrumb({
      message: `Bearer ${JWT}`,
      data: { url: 'https://shaktiprime.com/api/v1/me?token=abc', authorization: JWT },
    });
    expect(crumb).toEqual({
      message: 'Bearer [redacted]',
      data: { url: 'https://shaktiprime.com/api/v1/me' },
    });
    expect(scrubFields(['9876543210'])).toEqual(['3210'.padStart(10, '*')]);
  });

  it('hides a number of ten digits or more and every identity field, as the web does', () => {
    const PAN = 'ABCDE1234F';
    const identity = Object.fromEntries([...IDENTITY_KEYS].map((key) => [key, PAN]));
    const spelled = {
      panNumber: PAN,
      aadhaarNumber: '2345 6789 0123',
      accountNo: '50100234567890',
      bank_account_number: '50100234567890',
      ifscCode: 'HDFC0001234',
      uid: PAN,
    };
    const event = scrubEvent({
      extra: { mobile: 9876543210, customer: { ...identity, ...spelled }, visits: 3 },
      contexts: { lead: { whatsapp: 919876543210, documents: [spelled] } },
      breadcrumbs: [{ message: 'saved', data: { phone: 9876543210, ...spelled } }],
      spans: [{ description: 'save', data: { pan: PAN, mobile: 9876543210 } }],
    });
    const text = JSON.stringify(event);
    for (const hidden of [PAN, '9876543210', '2345 6789 0123', '50100234567890', 'HDFC0001234']) {
      expect(text).not.toContain(hidden);
    }
    expect(event.extra).toMatchObject({ mobile: '[number]', visits: 3 });
    expect(event.contexts).toMatchObject({ lead: { whatsapp: '[number]' } });
    for (const key of IDENTITY_KEYS) {
      expect(event.extra).toMatchObject({ customer: { [key]: '[redacted]' } });
    }
    expect(event.breadcrumbs[0]?.data).toMatchObject({
      phone: '[number]',
      panNumber: '[redacted]',
      aadhaarNumber: '[redacted]',
      accountNo: '[redacted]',
      ifscCode: '[redacted]',
    });
  });
});
