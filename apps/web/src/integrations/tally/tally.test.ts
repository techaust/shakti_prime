import { checkBatch, diffSnapshot } from '@shakti/domain';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isRestrictedVoucher,
  parseBatch,
  parseHeartbeat,
  parseSnapshot,
  voucherTypeOf,
} from './payloads';
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

  it('maps Tally type names to the types the BOS reads', () => {
    expect(voucherTypeOf('Sales')).toBe('sales');
    expect(voucherTypeOf(' Credit  Note ')).toBe('credit_note');
    expect(voucherTypeOf('Debit Note')).toBe('debit_note');
    expect(voucherTypeOf('Journal')).toBeUndefined();
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

  it('reads vouchers into the contract shape, skipping a journal and one without a GUID', () => {
    const vouchers = parseVoucherExport(xml);
    expect(vouchers).toEqual([
      {
        guid: GUID_A,
        alterId: 4180,
        type: 'sales',
        typeName: 'Sales',
        voucherNo: 'SS/2026-27/0418',
        date: '2026-09-27',
        partyName: 'Kisan Agro Traders & Sons',
        partyGstin: '08AAAAA0000A1Z5',
        buyerOrderNo: 'SS/SO/2026-27/0042',
        amount: '126500.00',
        isCancelled: false,
        isOptional: false,
        ledgerEntries: [
          { ledgerName: 'Kisan Agro Traders & Sons', amount: '-126500.00' },
          { ledgerName: 'Sales GST 18%', amount: '107203.39' },
        ],
        inventoryEntries: [
          {
            stockItemName: 'Submersible pump 5 HP',
            quantity: '2',
            unit: 'Nos',
            rate: '53601.69',
            amount: '107203.39',
          },
        ],
      },
      {
        guid: GUID_B,
        alterId: 4175,
        type: 'receipt',
        typeName: 'Receipt',
        voucherNo: 'RC/0311',
        date: '2026-09-27',
        partyName: 'Kisan Agro Traders & Sons',
        partyGstin: null,
        buyerOrderNo: null,
        amount: '50000.00',
        isCancelled: true,
        isOptional: false,
        ledgerEntries: [{ ledgerName: 'Kisan Agro Traders & Sons', amount: '50000.00' }],
        inventoryEntries: [],
      },
    ]);
    const ordered = [...vouchers].sort((a, b) => Number(a.alterId) - Number(b.alterId));
    expect(
      parseBatch({
        company: 'C',
        entityCode: 'SS',
        fromAlterId: 4170,
        maxAlterId: 4180,
        vouchers: ordered,
        ledgers: [],
      }).ok,
    ).toBe(true);
    expect(parseGuidExport(xml)).toHaveLength(3);
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
