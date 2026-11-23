import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOURNEY_SERVER_ENV } from '../../e2e/setup/server-env';
import { TEST_WEBHOOK_ENV } from '../../src/webhooks/signed-deliveries';
import {
  dialLeadPhone,
  KEPT_LOOKALIKES,
  MeasureRefused,
  VENDOR_CREDENTIALS,
  withoutVendorCredentials,
} from './safety';

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

const ENV_EXAMPLE = readFileSync(resolve(import.meta.dirname, '../../../../.env.example'), 'utf8');

const VENDOR_PREFIXES = [
  'EXOTEL_',
  'WHATSAPP_',
  'META_',
  'GOOGLE_',
  'LIVEKIT_',
  'SARVAM_',
  'ANTHROPIC_',
  'VOYAGE_',
  'QSTASH_',
  'UPSTASH_',
  'AWS_',
  'SES_',
  'SENTRY_',
];

/** Every variable an env file names, set or commented out (`# NAME=`). */
function variablesOf(text: string): string[] {
  const names = [...text.matchAll(/^#?[ \t]*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] ?? '');
  return [...new Set(names)];
}

function looksLikeVendorSecret(name: string): boolean {
  return (
    /_(KEY|SECRET|TOKEN|PASSWORD)$/.test(name) ||
    VENDOR_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

const KEPT: readonly string[] = Object.values(KEPT_LOOKALIKES).flat();

/** The variables of an env file that look like a vendor's secret and that neither list sorts. */
function unsorted(text: string): string[] {
  const sorted = new Set<string>([...VENDOR_CREDENTIALS, ...KEPT]);
  return variablesOf(text).filter((name) => looksLikeVendorSecret(name) && !sorted.has(name));
}

describe('VENDOR_CREDENTIALS against .env.example', () => {
  it('sorts every variable of .env.example that looks like a vendor secret', () => {
    expect(unsorted(ENV_EXAMPLE)).toEqual([]);
  });

  it('reports a new vendor key, set or commented out, and a new secret of any name', () => {
    const text = [
      'DATABASE_URL=postgres://local',
      'ACME_API_KEY=',
      '# EXOTEL_NEW_REGION=',
      'SOMEONE_ELSES_TOKEN=',
      '# a sentence that mentions SENTRY_SAMPLE=',
      ...VENDOR_CREDENTIALS.map((name) => `${name}=`),
    ].join('\n');
    expect(unsorted(text)).toEqual(['ACME_API_KEY', 'EXOTEL_NEW_REGION', 'SOMEONE_ELSES_TOKEN']);
  });

  it('keeps no variable that it also removes, and only variables .env.example names', () => {
    const removed = new Set<string>(VENDOR_CREDENTIALS);
    expect(KEPT.filter((name) => removed.has(name))).toEqual([]);
    const named = new Set(variablesOf(ENV_EXAMPLE));
    expect(KEPT.filter((name) => !named.has(name))).toEqual([]);
  });

  it('keeps a phrase only when the measuring server is given its own', () => {
    const given = new Set(Object.keys({ ...JOURNEY_SERVER_ENV, ...TEST_WEBHOOK_ENV }));
    expect(KEPT_LOOKALIKES.serverGivenPhrases.filter((name) => !given.has(name))).toEqual([]);
  });
});
