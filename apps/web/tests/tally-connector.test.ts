import { newId, type Principal } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import {
  envelopeCipher,
  localKeyProvider,
  executeCommand,
  mapTallyCompany,
  memoryKeyValue,
  newConnectorKey,
  registerTallyConnector,
  retireTallyConnectorKey,
  revokeTallyConnector,
  rotateTallyConnectorKey,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientMeta } from '../src/auth/client-address';
import { addressKey } from '../src/auth/request-cap';
import { forgetTallyConnector } from '../src/integrations/tally/connector-cache';
import {
  TALLY_CAPS,
  tallyBatchRoute,
  tallyCursorRoute,
  tallyHeartbeatRoute,
  tallyReleaseRoute,
  tallySnapshotRoute,
  type TallyRouteDeps,
} from '../src/integrations/tally/routes';
import { CONNECTOR_HEADERS, signConnectorRequest } from '../src/integrations/tally/signature';

// TC2's connector routes on real Postgres (docs/06-api.md §3.5, docs/03-roadmap-appendix/phase5.md
// §6.3 and §13): a call verifies under the connector's current key or, during a rotation, its next
// one, within five minutes of the server's clock; an unknown, revoked or tampered call is refused
// before anything is read; a batch resent under its Idempotency-Key is applied once, a gap answers
// cursor_mismatch, and a company not mapped to the connector answers forbidden.

const ORIGIN = 'http://localhost:3034';
const BASE = '/api/v1/connector/tally';
const RUN = newId().slice(-8);
const COMPANY = `TC2 web ${RUN}`;
const NOW = new Date();

let exec: Principal;
let connectorId: string;
let key: ReturnType<typeof newConnectorKey>;

/** The local field cipher the connectors' keys are sealed with here (a test phrase's bytes). */
const cipher = envelopeCipher(localKeyProvider(Buffer.alloc(32, 13).toString('base64')));
const deps = (now: Date = NOW): TallyRouteDeps => ({
  now: () => now,
  keyValue: memoryKeyValue(),
  cipher: () => cipher,
  options: () => ({}),
});
const guidBase = newId();
const guid = (n: number): string => `${guidBase}-${n.toString(16)}`;

function signed(
  method: 'GET' | 'POST',
  pathWithQuery: string,
  options: {
    body?: unknown;
    secret?: string;
    at?: Date;
    connector?: string;
    idempotencyKey?: string;
    tamper?: boolean;
  } = {},
): Request {
  const body = options.body === undefined ? '' : JSON.stringify(options.body);
  const timestamp = String(Math.floor((options.at ?? NOW).getTime() / 1000));
  const signature = signConnectorRequest(
    options.secret ?? key.key,
    method,
    pathWithQuery,
    timestamp,
    body,
  );
  const headers = new Headers({
    [CONNECTOR_HEADERS.id]: options.connector ?? connectorId,
    [CONNECTOR_HEADERS.timestamp]: timestamp,
    [CONNECTOR_HEADERS.signature]: signature,
    'content-type': 'application/json',
  });
  if (options.idempotencyKey !== undefined) headers.set('idempotency-key', options.idempotencyKey);
  return new Request(`${ORIGIN}${pathWithQuery}`, {
    method,
    headers,
    ...(method === 'POST' ? { body: options.tamper === true ? `${body} ` : body } : {}),
  });
}

const cursorPath = (company = COMPANY) => `${BASE}/cursor?company=${encodeURIComponent(company)}`;

function voucher(n: number, alterId: number) {
  return {
    guid: guid(n),
    alterId,
    type: 'sales',
    typeName: 'Sales',
    voucherNo: `WEB/${n.toString()}`,
    date: '2026-09-27',
    partyName: 'Kisan Agro Traders',
    partyGstin: null,
    buyerOrderNo: null,
    amount: '2500.00',
    isCancelled: false,
    isOptional: false,
    ledgerEntries: [{ ledgerName: 'Kisan Agro Traders', amount: '2500.00' }],
    inventoryEntries: [],
  };
}

const batchBody = (fromAlterId: number, maxAlterId: number, vouchers: unknown[], code = 'SS') => ({
  company: COMPANY,
  entityCode: code,
  fromAlterId,
  maxAlterId,
  vouchers,
  ledgers: [],
});

async function json(
  response: Response,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const reasonOf = (body: Record<string, unknown>) =>
  (body.error as { details?: { reason?: string } } | undefined)?.details?.reason;

beforeAll(async () => {
  exec = await createTestPrincipal('executive', [1, 2, 3, 4]);
  key = newConnectorKey();
  const registered = await executeCommand(
    exec,
    { entityIds: [1] },
    registerTallyConnector,
    { name: `TC2 web ${RUN}`, key: key.key },
    { fieldCipher: cipher },
  );
  connectorId = registered.id;
  await executeCommand(exec, { entityIds: [1] }, mapTallyCompany, {
    connectorId,
    tallyCompany: COMPANY,
    entityId: 1,
  });
});

afterAll(async () => {
  const [row] = await asMigrator(
    (m) => m<{ revoked: boolean }[]>`
      select revoked_at is not null as revoked from tally_connectors where id = ${connectorId}`,
  );
  if (row?.revoked === false) {
    await executeCommand(exec, { entityIds: [1] }, revokeTallyConnector, { connectorId });
  }
  await closeDb();
});

describe('the connector’s signature', () => {
  it('answers a signed cursor read with zero before any batch', async () => {
    const { status, body } = await json(
      await tallyCursorRoute(signed('GET', cursorPath()), deps()),
    );
    expect(status).toBe(200);
    expect(body).toEqual({ company: COMPANY, lastAlterId: 0, updatedAt: null });
  });

  it('verifies the query as it arrived, a space written as +', async () => {
    const path = `${BASE}/cursor?${new URLSearchParams({ company: COMPANY }).toString()}`;
    expect(path).toContain('+');
    const { status, body } = await json(await tallyCursorRoute(signed('GET', path), deps()));
    expect(status).toBe(200);
    expect(body.company).toBe(COMPANY);
  });

  it('accepts a timestamp within five minutes either way, and refuses one beyond', async () => {
    for (const [offsetSeconds, status] of [
      [-290, 200],
      [290, 200],
      [-310, 401],
      [310, 401],
    ] as const) {
      const at = new Date(NOW.getTime() + offsetSeconds * 1000);
      const response = await tallyCursorRoute(signed('GET', cursorPath(), { at }), deps());
      expect({ offsetSeconds, status: response.status }).toEqual({ offsetSeconds, status });
    }
  });

  it('refuses an unknown connector, a wrong key and a tampered body before anything is read', async () => {
    const unknown = await json(
      await tallyCursorRoute(signed('GET', cursorPath(), { connector: newId() }), deps()),
    );
    expect(unknown.status).toBe(401);
    expect(reasonOf(unknown.body)).toBe('tally_connector_refused');
    const wrongKey = await tallyCursorRoute(
      signed('GET', cursorPath(), { secret: newConnectorKey().key }),
      deps(),
    );
    expect(wrongKey.status).toBe(401);
    const tampered = await tallyHeartbeatRoute(
      signed('POST', `${BASE}/heartbeat`, {
        body: {
          connectorVersion: '1.0.0',
          tallyVersion: 'TallyPrime 5.1',
          companies: [{ name: COMPANY, lastAlterId: 0, reachable: true }],
          queueDepth: 0,
        },
        tamper: true,
      }),
      deps(),
    );
    expect(tampered.status).toBe(401);
  });

  it('verifies under both keys during a rotation, and only the new one once the old is retired', async () => {
    const next = newConnectorKey();
    await executeCommand(
      exec,
      { entityIds: [1] },
      rotateTallyConnectorKey,
      { connectorId, key: next.key },
      { fieldCipher: cipher },
    );
    // The Admin action forgets the connector on its own instance; another reads it again within
    // the minute, or at once after a refused signature once its reading is ten seconds old.
    forgetTallyConnector(connectorId);
    for (const secret of [key.key, next.key]) {
      const response = await tallyCursorRoute(signed('GET', cursorPath(), { secret }), deps());
      expect(response.status).toBe(200);
    }
    await executeCommand(exec, { entityIds: [1] }, retireTallyConnectorKey, { connectorId });
    // A rotation under way is read again on every call, so the old key stops at once here too.
    const old = await tallyCursorRoute(signed('GET', cursorPath(), { secret: key.key }), deps());
    expect(old.status).toBe(401);
    key = next;
    const current = await tallyCursorRoute(signed('GET', cursorPath()), deps());
    expect(current.status).toBe(200);
  });
});

describe('the batch route', () => {
  const idempotencyKey = newId();
  const first = batchBody(0, 10, [voucher(1, 4), voucher(2, 9)]);

  it('refuses a batch without an Idempotency-Key', async () => {
    const { status, body } = await json(
      await tallyBatchRoute(signed('POST', `${BASE}/batches`, { body: first }), deps()),
    );
    expect(status).toBe(400);
    expect(reasonOf(body)).toBe('tally_idempotency_key_missing');
  });

  it('applies a batch once, answering its resend from the first call', async () => {
    const one = await json(
      await tallyBatchRoute(
        signed('POST', `${BASE}/batches`, { body: first, idempotencyKey }),
        deps(),
      ),
    );
    expect(one).toEqual({
      status: 200,
      body: {
        company: COMPANY,
        accepted: { vouchersNew: 2, vouchersChanged: 0, vouchersUnchanged: 0, ledgers: 0 },
        lastAlterId: 10,
        held: [],
      },
    });
    const again = await json(
      await tallyBatchRoute(
        signed('POST', `${BASE}/batches`, { body: first, idempotencyKey }),
        deps(),
      ),
    );
    expect(again).toEqual(one);
    const [stored] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from tally_vouchers
        where guid in (${guid(1)}, ${guid(2)})`,
    );
    expect(stored?.n).toBe(2);
    const cursor = await json(await tallyCursorRoute(signed('GET', cursorPath()), deps()));
    expect(cursor.body.lastAlterId).toBe(10);
  });

  it('answers cursor_mismatch to a gap and to the same batch under another key', async () => {
    for (const body of [first, batchBody(12, 20, [voucher(3, 15)])]) {
      const response = await json(
        await tallyBatchRoute(
          signed('POST', `${BASE}/batches`, { body, idempotencyKey: newId() }),
          deps(),
        ),
      );
      expect(response.status).toBe(409);
      expect(reasonOf(response.body)).toBe('cursor_mismatch');
    }
  });

  it('answers the same key with a different body as a mismatch', async () => {
    const response = await json(
      await tallyBatchRoute(
        signed('POST', `${BASE}/batches`, {
          body: batchBody(0, 10, [voucher(1, 5)]),
          idempotencyKey,
        }),
        deps(),
      ),
    );
    expect(response.status).toBe(409);
    expect(reasonOf(response.body)).toBe('idempotency_mismatch');
  });

  it('refuses a company not mapped to the connector, or under another company’s code', async () => {
    for (const body of [
      { ...batchBody(10, 11, []), company: `${COMPANY} other` },
      batchBody(10, 11, [], 'SMP'),
    ]) {
      const response = await json(
        await tallyBatchRoute(
          signed('POST', `${BASE}/batches`, { body, idempotencyKey: newId() }),
          deps(),
        ),
      );
      expect(response.status).toBe(403);
      expect(reasonOf(response.body)).toBe('tally_company_not_mapped');
    }
  });

  it('refuses a body that is not the contract', async () => {
    const response = await tallyBatchRoute(
      signed('POST', `${BASE}/batches`, {
        body: { ...first, vouchers: [{ guid: 'not a guid' }] },
        idempotencyKey: newId(),
      }),
      deps(),
    );
    expect(response.status).toBe(400);
  });
});

describe('the release route and a runtime with no cipher', () => {
  it('answers a verified connector that there is no release yet', async () => {
    const { status, body } = await json(
      await tallyReleaseRoute(signed('GET', `${BASE}/release`), deps()),
    );
    expect(status).toBe(404);
    expect(reasonOf(body)).toBe('tally_no_release');
    const unsigned = await tallyReleaseRoute(
      signed('GET', `${BASE}/release`, { connector: newId() }),
      deps(),
    );
    expect(unsigned.status).toBe(401);
  });

  it('verifies on a warm instance before any read, and refuses a wrong key there too', async () => {
    // With no cipher, a call that reached the database's keys would answer 503: these do not.
    const noCipher = { ...deps(), cipher: () => undefined };
    const warm = await tallyCursorRoute(signed('GET', cursorPath()), noCipher);
    expect(warm.status).toBe(200);
    const wrong = await tallyCursorRoute(
      signed('GET', cursorPath(), { secret: newConnectorKey().key }),
      noCipher,
    );
    expect(wrong.status).toBe(401);
  });

  it('answers unavailable when the keys cannot be opened on this runtime', async () => {
    forgetTallyConnector(connectorId);
    const response = await tallyCursorRoute(signed('GET', cursorPath()), {
      ...deps(),
      cipher: () => undefined,
    });
    expect(response.status).toBe(503);
  });

  it('refuses a call with a stale or missing signature before reading its body', async () => {
    const stale = signed('POST', `${BASE}/heartbeat`, {
      body: { not: 'read' },
      at: new Date(NOW.getTime() - 3600_000),
    });
    expect((await tallyHeartbeatRoute(stale, deps())).status).toBe(401);
    expect(stale.bodyUsed).toBe(false);
    const unsigned = new Request(`${ORIGIN}${cursorPath()}`, {
      headers: { [CONNECTOR_HEADERS.id]: connectorId },
    });
    expect((await tallyCursorRoute(unsigned, deps())).status).toBe(401);
  });

  it('caps the calls per connector and per address, answering when to try again', async () => {
    const address = addressKey(clientMeta(signed('GET', cursorPath()).headers).ip ?? undefined);
    for (const [key, rule] of [
      [`tally:connector:${connectorId}`, TALLY_CAPS.perConnector],
      [`tally:address:${address}`, TALLY_CAPS.perAddress],
    ] as const) {
      const store = memoryKeyValue();
      for (let i = 0; i < rule.max; i += 1) await store.incr(`cap:${key}`, rule.window);
      const response = await tallyCursorRoute(signed('GET', cursorPath()), {
        ...deps(),
        keyValue: store,
      });
      expect(response.status, key).toBe(429);
      expect(response.headers.get('retry-after')).toBe(String(rule.window));
    }
  });
});

describe('the snapshot and heartbeat routes', () => {
  it('answers a snapshot with what it knows, removed and lacks', async () => {
    const { status, body } = await json(
      await tallySnapshotRoute(
        signed('POST', `${BASE}/snapshot`, {
          body: {
            company: COMPANY,
            entityCode: 'SS',
            asOf: new Date(NOW.getTime() + 60_000).toISOString(),
            fromDate: '2026-04-01',
            voucherGuids: [guid(1), guid(70)],
            ledgerBalances: [
              {
                guid: guid(90),
                name: 'Kisan Agro Traders',
                closingBalance: '-2500.00',
                asOf: '2026-09-27',
              },
            ],
          },
        }),
        deps(),
      ),
    );
    expect(status).toBe(200);
    expect(body).toEqual({
      company: COMPANY,
      known: 1,
      tombstoned: 1,
      missingOnServer: [guid(70)],
    });
  });

  it('records a heartbeat and offers no update before the BOS publishes releases', async () => {
    const { status, body } = await json(
      await tallyHeartbeatRoute(
        signed('POST', `${BASE}/heartbeat`, {
          body: {
            connectorVersion: '1.2.0',
            tallyVersion: 'TallyPrime 5.1',
            companies: [{ name: COMPANY, lastAlterId: 10, reachable: true }],
            queueDepth: 0,
          },
        }),
        deps(),
      ),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ latestVersion: '1.2.0', updateAvailable: false });
  });

  it('refuses every call of a revoked connector', async () => {
    await executeCommand(exec, { entityIds: [1] }, revokeTallyConnector, { connectorId });
    // An instance that read it within the minute is refused by the definers, and reads it again.
    const warm = await tallyCursorRoute(signed('GET', cursorPath()), deps());
    expect(warm.status).toBe(403);
    const response = await tallyCursorRoute(signed('GET', cursorPath()), deps());
    expect(response.status).toBe(401);
  });
});
