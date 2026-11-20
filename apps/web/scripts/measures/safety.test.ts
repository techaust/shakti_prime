import { describe, expect, it } from 'vitest';
import { dialLeadPhone, MeasureRefused, withoutVendorCredentials } from './safety';

// The G2 measures' guards against real calls and vendor calls (review H1).

describe('withoutVendorCredentials', () => {
  it('removes Exotel’s keys and every other vendor credential, and keeps the rest', () => {
    const env = withoutVendorCredentials({
      EXOTEL_ACCOUNT_SID: 'account',
      EXOTEL_API_KEY: 'key',
      EXOTEL_API_TOKEN: 'token',
      EXOTEL_SUBDOMAIN: 'api.in.exotel.com',
      SENTRY_DSN: 'dsn',
      ANTHROPIC_API_KEY: 'model key',
      WHATSAPP_ACCESS_TOKEN: 'whatsapp',
      QSTASH_TOKEN: 'queue',
      MAILER: 'ses',
      DATABASE_URL: 'postgres://local',
      EXOTEL_CALLBACK_SECRET: 'kept: it only signs addresses',
    });
    expect(env).toEqual({
      MAILER: 'log',
      DATABASE_URL: 'postgres://local',
      EXOTEL_CALLBACK_SECRET: 'kept: it only signs addresses',
    });
  });
});

describe('dialLeadPhone', () => {
  const madeUp = () => '98765 43210';

  it('makes a number up only for the server started here, whose provider is simulated', () => {
    expect(dialLeadPhone({ serverStartedHere: true, leadPhone: undefined, madeUp })).toBe(
      '98765 43210',
    );
  });

  it('refuses another server without a phone the owner’s people answer', () => {
    expect(() => dialLeadPhone({ serverStartedHere: false, leadPhone: undefined, madeUp })).toThrow(
      MeasureRefused,
    );
    expect(() => dialLeadPhone({ serverStartedHere: false, leadPhone: '  ', madeUp })).toThrow(
      MeasureRefused,
    );
  });

  it('dials the given phone wherever the server runs', () => {
    expect(dialLeadPhone({ serverStartedHere: false, leadPhone: '98000 00999', madeUp })).toBe(
      '98000 00999',
    );
  });
});
