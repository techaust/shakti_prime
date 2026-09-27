import { checkBatch, diffSnapshot } from '@shakti/domain';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBatch, parseHeartbeat, parseSnapshot } from './payloads';
import {
  canonicalRequest,
  CONNECTOR_HEADERS,
  signConnectorRequest,
  verifyConnectorRequest,
} from './signature';
import {
  parseGuidExport,
  parseVoucherExport,
  voucherGuidsRequest,
  vouchersSinceRequest,
} from './tally-xml';

// Low-entropy phrases, so the secret scan never mistakes them for keys (CLAUDE.md).
const KEY = 'tally-connector-test-key-one';
const NEXT_KEY = 'tally-connector-test-key-two';
const CONNECTOR = 'tally-ss-office-1';
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
      /^v1=[0-9a-f]{64}$/,
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

describe('payloads', () => {
  it('reads the batch fixture and marks purchase vouchers restricted', () => {
    const parsed = parseBatch(JSON.parse(rawBatch));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.company).toBe('Shakti Supreme Pvt Ltd 2026-27');
    expect(parsed.value.vouchers.map((v) => [v.voucherType, v.restricted])).toEqual([
      ['Sales', false],
      ['Receipt', false],
      ['Purchase', true],
      ['Sales', false],
    ]);
    expect(parsed.value.ledgers[0]?.gstin).toBe('08AAAAA0000A1Z5');
  });

  it('names every field it cannot read, including a float amount and a bad date', () => {
    const parsed = parseBatch({
      company: 'X',
      maxAlterId: -1,
      vouchers: [{ guid: 'g', alterId: 1, voucherType: 'Sales', date: '27/09/2026', amount: 12.5 }],
      ledgers: [{ guid: 'l', alterId: 2, name: 'Party', gstin: 'NOT-A-GSTIN' }],
    });
    expect(parsed).toEqual({
      ok: false,
      problems: [
        'entityCode',
        'maxAlterId',
        'vouchers[0].date',
        'vouchers[0].amount',
        'ledgers[0].gstin',
      ],
    });
  });

  it('refuses a batch above the size limit', () => {
    const vouchers = Array.from({ length: 501 }, () => ({}));
    const parsed = parseBatch({ company: 'X', entityCode: 'SS', maxAlterId: 1, vouchers });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problems).toContain('vouchers: too many');
  });

  it('reads a heartbeat and a snapshot', () => {
    expect(
      parseHeartbeat({
        connectorVersion: '0.1.0',
        tallyVersion: 'TallyPrime 6.1',
        companies: [{ name: 'Shakti Supreme Pvt Ltd 2026-27', lastAlterId: 4180 }],
      }),
    ).toMatchObject({ ok: true, value: { companies: [{ lastAlterId: 4180 }] } });
    expect(parseHeartbeat({ connectorVersion: '0.1.0' })).toEqual({
      ok: false,
      problems: ['tallyVersion'],
    });
    expect(
      parseSnapshot({ company: 'C', asOf: '2026-09-28T00:00:00+05:30', voucherGuids: ['a', 'b'] }),
    ).toMatchObject({ ok: true, value: { voucherGuids: ['a', 'b'] } });
    expect(parseSnapshot({ company: 'C', asOf: 'yesterday', voucherGuids: ['a', 7] })).toEqual({
      ok: false,
      problems: ['asOf', 'voucherGuids'],
    });
  });
});

describe('the Tally XML export (spike reader)', () => {
  const xml = readFileSync(new URL('./fixtures/vouchers-export.xml', import.meta.url), 'utf8');

  it('asks for vouchers after the cursor, escaping the company name', () => {
    const request = vouchersSinceRequest('Shakti <Supreme> & Co', 4170);
    expect(request).toContain(
      '<SVCURRENTCOMPANY>Shakti &lt;Supreme&gt; &amp; Co</SVCURRENTCOMPANY>',
    );
    expect(request).toContain('$ALTERID &gt; 4170');
    expect(() => vouchersSinceRequest('C', -1)).toThrow();
    expect(voucherGuidsRequest('C')).toContain('<FETCH>GUID</FETCH>');
  });

  it('reads vouchers into the batch shape the BOS accepts, skipping one without a GUID', () => {
    const vouchers = parseVoucherExport(xml);
    expect(vouchers).toEqual([
      {
        guid: '5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a11',
        alterId: 4180,
        voucherType: 'Sales',
        date: '2026-09-27',
        number: 'SS/2026-27/0418',
        amount: '126500.00',
        cancelled: false,
        partyLedger: 'Kisan Agro Traders & Sons',
        buyerOrderNo: 'SS/SO/2026-27/0042',
      },
      {
        guid: '5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a12',
        alterId: 4175,
        voucherType: 'Receipt',
        date: '2026-09-27',
        number: 'RC/0311',
        amount: '50000.00',
        cancelled: true,
        partyLedger: 'Kisan Agro Traders & Sons',
      },
    ]);
    expect(
      parseBatch({ company: 'C', entityCode: 'SS', maxAlterId: 4180, vouchers, ledgers: [] }).ok,
    ).toBe(true);
    expect(parseGuidExport(xml)).toHaveLength(2);
  });
});

describe('the fixture through the sync rules', () => {
  it('moves the cursor, keeps the edited sales voucher once, and tombstones what Tally deleted', () => {
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
      asOf: '2026-09-29T06:00:00Z',
      voucherGuids: stored.map((s) => s.guid).filter((g) => !g.endsWith('0a12')),
    });
    if (!snapshot.ok) throw new Error('snapshot expected to parse');
    expect(diffSnapshot(stored, snapshot.value)).toEqual({
      ok: true,
      diff: {
        tombstones: ['5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a12'],
        missing: [],
        reappeared: [],
      },
    });
  });
});
