import { checkBatch, diffSnapshot } from '@shakti/domain';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRestrictedVoucher, parseBatch, parseHeartbeat, parseSnapshot } from './payloads';
import {
  canonicalRequest,
  CONNECTOR_HEADERS,
  signConnectorRequest,
  verifyConnectorRequest,
} from './signature';

// Low-entropy phrases, so the secret scan never mistakes them for keys (CLAUDE.md).
const KEY = 'tally-connector-test-key-one';
const NEXT_KEY = 'tally-connector-test-key-two';
const CONNECTOR = '01931f6e-8a2b-7c3d-9e4f-00000000c0de';
const PATH = '/api/v1/connector/tally/batches';
const NOW = new Date('2026-09-28T06:00:00Z');
const NOW_SECONDS = String(Math.floor(NOW.getTime() / 1000));

const rawBatch = readFileSync(new URL('./fixtures/batch.json', import.meta.url), 'utf8');
const keysFor = (id: string) => (id === CONNECTOR ? [KEY] : []);

function signed(
  options: {
    key?: string;
    timestamp?: string;
    body?: string;
    method?: string;
    path?: string;
    omit?: string;
  } = {},
) {
  const timestamp = options.timestamp ?? NOW_SECONDS;
  const body = options.body ?? rawBatch;
  const headers = new Headers({
    [CONNECTOR_HEADERS.id]: CONNECTOR,
    [CONNECTOR_HEADERS.timestamp]: timestamp,
    [CONNECTOR_HEADERS.signature]: signConnectorRequest(
      options.key ?? KEY,
      'POST',
      PATH,
      timestamp,
      rawBatch,
    ),
  });
  if (options.omit !== undefined) headers.delete(options.omit);
  return {
    method: options.method ?? 'POST',
    pathWithQuery: options.path ?? PATH,
    headers,
    body,
  };
}

describe('connector request signing', () => {
  it('names the method, path, time and body hash in the canonical string', () => {
    expect(canonicalRequest('post', '/x?a=1', '1790000000', '{}')).toBe(
      'POST\n/x?a=1\n1790000000\n44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
    expect(signConnectorRequest(KEY, 'POST', PATH, NOW_SECONDS, rawBatch)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('accepts a request signed with the current or, during a rotation, the next key', () => {
    expect(verifyConnectorRequest(signed(), keysFor, NOW)).toEqual({
      ok: true,
      connectorId: CONNECTOR,
    });
    const rotating = () => [KEY, NEXT_KEY];
    expect(verifyConnectorRequest(signed({ key: NEXT_KEY }), rotating, NOW)).toMatchObject({
      ok: true,
    });
  });

  it('accepts up to five minutes of clock difference either way, and no more', () => {
    const at = (offset: number) => String(Number(NOW_SECONDS) + offset);
    for (const offset of [-300, 300]) {
      const request = signed({ timestamp: at(offset) });
      request.headers.set(
        CONNECTOR_HEADERS.signature,
        signConnectorRequest(KEY, 'POST', PATH, at(offset), rawBatch),
      );
      expect(verifyConnectorRequest(request, keysFor, NOW)).toMatchObject({ ok: true });
    }
    for (const offset of [-301, 301]) {
      const request = signed({ timestamp: at(offset) });
      request.headers.set(
        CONNECTOR_HEADERS.signature,
        signConnectorRequest(KEY, 'POST', PATH, at(offset), rawBatch),
      );
      expect(verifyConnectorRequest(request, keysFor, NOW)).toEqual({
        ok: false,
        problem: 'stale_timestamp',
      });
    }
  });

  // The same vectors are signed by the connector in apps/tally-connector/test/signing.test.ts, so a
  // change on either side fails one of the two.
  it('verifies what the connector signs, a batch and a cursor read with its query', () => {
    const vectors = [
      {
        method: 'POST',
        pathWithQuery: PATH,
        body: '{"company":"Shakti Supreme","fromAlterId":0}',
        signature: '08ba73cb388ad3c2d0689a1ebdf6556a21f464ad4a3c0f0cfb356c46160be804',
      },
      {
        method: 'GET',
        pathWithQuery: '/api/v1/connector/tally/cursor?company=Shakti+Supreme',
        body: '',
        signature: 'acb3706f74c2962b35ab2f1ea230ea46566c2c6a4ce0100e8ceac686290e63c6',
      },
    ];
    for (const { signature, ...request } of vectors) {
      const headers = new Headers({
        [CONNECTOR_HEADERS.id]: CONNECTOR,
        [CONNECTOR_HEADERS.timestamp]: NOW_SECONDS,
        [CONNECTOR_HEADERS.signature]: signature,
      });
      expect(verifyConnectorRequest({ ...request, headers }, keysFor, NOW)).toEqual({
        ok: true,
        connectorId: CONNECTOR,
      });
    }
  });

  it('refuses a changed body, path or method, a foreign key, and a missing header', () => {
    const bad = { ok: false, problem: 'bad_signature' };
    expect(verifyConnectorRequest(signed({ body: `${rawBatch} ` }), keysFor, NOW)).toEqual(bad);
    expect(
      verifyConnectorRequest(signed({ path: '/api/v1/connector/tally/snapshot' }), keysFor, NOW),
    ).toEqual(bad);
    expect(verifyConnectorRequest(signed({ method: 'PUT' }), keysFor, NOW)).toEqual(bad);
    expect(verifyConnectorRequest(signed({ key: 'someone-elses-key' }), keysFor, NOW)).toEqual(bad);
    expect(
      verifyConnectorRequest(signed({ omit: CONNECTOR_HEADERS.signature }), keysFor, NOW),
    ).toEqual({ ok: false, problem: 'missing_headers' });
    expect(verifyConnectorRequest(signed({ timestamp: 'soon' }), keysFor, NOW)).toEqual({
      ok: false,
      problem: 'missing_headers',
    });
    expect(verifyConnectorRequest(signed(), () => [], NOW)).toEqual({
      ok: false,
      problem: 'unknown_connector',
    });
  });
});

const GUID_A = '5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a11';
const GUID_B = '5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a12';

describe('payloads (the published connector contract)', () => {
  const batch = () => JSON.parse(rawBatch) as { vouchers: Record<string, unknown>[] };

  it('reads the batch fixture and marks purchase vouchers restricted', () => {
    const parsed = parseBatch(JSON.parse(rawBatch));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.company).toBe('Shakti Supreme Pvt Ltd 2026-27');
    expect(parsed.value.vouchers.map((v) => [v.type, isRestrictedVoucher(v.type)])).toEqual([
      ['receipt', false],
      ['purchase', true],
      ['sales', false],
    ]);
    expect(parsed.value.vouchers[2]?.ledgerEntries[0]?.amount).toBe('-126500.00');
    expect(parsed.value.ledgers[0]?.gstin).toBe('08AAAAA0000A1Z5');
  });

  it('names every field it cannot read, including a float amount and a bad date', () => {
    const parsed = parseBatch({
      company: 'X',
      fromAlterId: 0,
      maxAlterId: 5,
      vouchers: [{ ...batch().vouchers[0], alterId: 1, date: '27/09/2026', amount: 12.5 }],
      ledgers: [],
    });
    expect(parsed).toEqual({
      ok: false,
      problems: ['entityCode', 'vouchers[0].date', 'vouchers[0].amount'],
    });
  });

  it('refuses a voucher twice in one batch, a row outside the range, and a batch above the limit', () => {
    const vouchers = batch().vouchers;
    const twice = { ...batch(), vouchers: [vouchers[2], { ...vouchers[2] }] };
    expect(parseBatch(twice)).toMatchObject({
      ok: false,
      problems: ['vouchers: a voucher appears twice'],
    });
    const outside = { ...batch(), fromAlterId: 4175 };
    expect(parseBatch(outside)).toMatchObject({
      ok: false,
      problems: ['vouchers: a row lies outside the batch range'],
    });
    const many = { ...batch(), vouchers: Array.from({ length: 501 }, () => ({})) };
    const tooMany = parseBatch(many);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.problems).toContain('vouchers');
  });

  it('reads a heartbeat and a snapshot', () => {
    expect(
      parseHeartbeat({
        connectorVersion: '0.1.0',
        tallyVersion: 'TallyPrime 6.1',
        companies: [{ name: 'Shakti Supreme Pvt Ltd 2026-27', lastAlterId: 4180, reachable: true }],
        queueDepth: 0,
      }),
    ).toMatchObject({ ok: true, value: { companies: [{ lastAlterId: 4180 }] } });
    expect(parseHeartbeat({ connectorVersion: '0.1.0' })).toEqual({
      ok: false,
      problems: ['tallyVersion', 'companies', 'queueDepth'],
    });
    const snapshot = {
      company: 'C',
      entityCode: 'SS',
      asOf: '2026-09-28T00:00:00Z',
      fromDate: '2026-04-01',
      voucherGuids: [GUID_A, GUID_B],
    };
    expect(parseSnapshot(snapshot)).toMatchObject({
      ok: true,
      value: { voucherGuids: [GUID_A, GUID_B] },
    });
    expect(parseSnapshot({ ...snapshot, asOf: 'yesterday', voucherGuids: ['a', 7] })).toEqual({
      ok: false,
      problems: ['asOf', 'voucherGuids[0]', 'voucherGuids[1]'],
    });
  });

  // TC1: the dealers' closing balances travel with the daily snapshot.
  it('reads the party ledger balances of a snapshot, each ledger once', () => {
    const balance = {
      guid: GUID_A,
      name: 'Kisan Agro Traders',
      closingBalance: '-76500.00',
      asOf: '2026-09-28',
    };
    const snapshot = {
      company: 'C',
      entityCode: 'SS',
      asOf: '2026-09-28T00:00:00Z',
      fromDate: '2026-04-01',
      voucherGuids: [GUID_B],
      ledgerBalances: [balance],
    };
    expect(parseSnapshot(snapshot)).toMatchObject({
      ok: true,
      value: { ledgerBalances: [balance] },
    });
    expect(parseSnapshot({ ...snapshot, ledgerBalances: [balance, balance] })).toEqual({
      ok: false,
      problems: ['ledgerBalances: a ledger appears twice'],
    });
    expect(
      parseSnapshot({
        ...snapshot,
        ledgerBalances: [{ ...balance, closingBalance: -76500, asOf: 'today' }],
      }),
    ).toEqual({
      ok: false,
      problems: ['ledgerBalances[0].closingBalance', 'ledgerBalances[0].asOf'],
    });
  });
});

describe('the fixture through the sync rules', () => {
  it('moves the cursor, applies each voucher once, and tombstones what Tally deleted', () => {
    const parsed = parseBatch(JSON.parse(rawBatch));
    if (!parsed.ok) throw new Error('fixture expected to parse');
    const check = checkBatch(4170, parsed.value);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.outcome.cursor).toBe(4180);
    expect(check.outcome.fresh.map((v) => v.alterId)).toEqual([4175, 4178, 4180]);

    // Next day, Tally no longer holds the receipt: it was deleted.
    const stored = check.outcome.fresh.map((v) => ({
      guid: v.guid,
      receivedAt: NOW,
      tombstoned: false,
    }));
    const snapshot = parseSnapshot({
      company: parsed.value.company,
      entityCode: parsed.value.entityCode,
      asOf: '2026-09-29T06:00:00Z',
      fromDate: '2026-04-01',
      voucherGuids: stored.map((s) => s.guid).filter((g) => !g.endsWith('0a12')),
    });
    if (!snapshot.ok) throw new Error('snapshot expected to parse');
    expect(
      diffSnapshot(stored, { ...snapshot.value, asOf: new Date(snapshot.value.asOf) }),
    ).toEqual({
      ok: true,
      diff: {
        tombstones: ['5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a12'],
        missing: [],
        reappeared: [],
      },
    });
  });
});
