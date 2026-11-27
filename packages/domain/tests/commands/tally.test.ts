import {
  newId,
  SYSTEM_MATRIX,
  type Principal,
  type TallyConnectorDto,
  type TallyLedger,
  type TallyVoucher,
} from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal, principalFor } from '@shakti/db/testing';
import { withRequestContext } from '@shakti/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeCommand } from '../../src/command/execute';
import {
  mapTallyCompany,
  registerTallyConnector,
  retireTallyConnectorKey,
  revokeTallyConnector,
  rotateTallyConnectorKey,
  unmapTallyCompany,
} from '../../src/commands/tally/connectors';
import {
  confirmTallySnapshot,
  ingestTallyBatch,
  recordTallyHeartbeat,
  recordTallySnapshot,
} from '../../src/commands/tally/ingest';
import { findTallyConnector, readTallyCursor } from '../../src/queries/tally/connector';
import { connectorSigningKey, newConnectorKey } from '../../src/tally/connector-key';

// TC2 Tally ingest on real Postgres (docs/03-roadmap-appendix/phase5.md §6.3, §13): an Executive
// registers and maps a connector; the connector's batches move the cursor forward once each, a
// resend under its key is answered from the first call, a gap answers cursor_mismatch; a snapshot
// within its limits tombstones at once and one over them waits for Accounts; the heartbeat records
// what the connector reports. Every assertion reads this run's own connector and companies.

afterAll(closeDb);

const RUN = newId().slice(-8);
const COMPANY = `TC2 ${RUN} Shakti Supreme`;
const SPARE = `TC2 ${RUN} Agro Solar`;
let exec: Principal;
let accounts: Principal;
let connector: TallyConnectorDto;

const guidBase = newId();
const guid = (n: number): string => `${guidBase}-${n.toString(16)}`;

function connectorPrincipal(entityIds: number[] = [1]): Principal {
  return {
    id: connector.id,
    kind: 'system',
    roleKey: 'system:tally_connector',
    entityIds,
    permissions: [...SYSTEM_MATRIX['system:tally_connector']],
  };
}

function voucher(n: number, alterId: number, type: TallyVoucher['type'] = 'sales'): TallyVoucher {
  return {
    guid: guid(n),
    alterId,
    type,
    typeName: type,
    voucherNo: `TC2/${n.toString()}`,
    date: '2026-09-27',
    partyName: 'Kisan Agro Traders',
    partyGstin: null,
    buyerOrderNo: null,
    amount: '1000.00',
    isCancelled: false,
    isOptional: false,
    ledgerEntries: [{ ledgerName: 'Kisan Agro Traders', amount: '1000.00' }],
    inventoryEntries: [],
  };
}

function batch(
  fromAlterId: number,
  maxAlterId: number,
  vouchers: TallyVoucher[],
  ledgers: TallyLedger[] = [],
) {
  return {
    entityId: 1,
    batch: { company: COMPANY, entityCode: 'SS', fromAlterId, maxAlterId, vouchers, ledgers },
  };
}

async function failure(
  promise: Promise<unknown>,
): Promise<{ code: string | undefined; reason: unknown }> {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; details?: { reason?: unknown } };
    return { code: err.code, reason: err.details?.reason };
  }
  throw new Error('expected the call to fail');
}

async function stateOf(table: string, g: string): Promise<string | undefined> {
  const [row] = await asMigrator(
    (m) => m<{ state: string }[]>`select state from ${m(table)} where guid = ${g}`,
  );
  return row?.state;
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive', [1, 2, 3, 4]);
  accounts = await createTestPrincipal('accounts', [1]);
  const key = newConnectorKey();
  connector = await executeCommand(exec, { entityIds: [1, 2, 3, 4] }, registerTallyConnector, {
    name: `TC2 test ${RUN}`,
    keyHash: key.keyHash,
    keyHint: key.keyHint,
  });
  connector = await executeCommand(exec, { entityIds: [1, 2, 3, 4] }, mapTallyCompany, {
    connectorId: connector.id,
    tallyCompany: COMPANY,
    entityId: 1,
  });
});

afterAll(async () => {
  // A revoked connector frees its companies; its rows stay, as Tally's mirror does.
  if (connector.revokedAt === null) {
    await executeCommand(exec, { entityIds: [1, 2, 3, 4] }, revokeTallyConnector, {
      connectorId: connector.id,
    });
  }
});

describe('Admin › Integrations › Tally', () => {
  it('registers a connector by its key’s hash and maps a company', () => {
    expect(connector.companies).toEqual([
      expect.objectContaining({ tallyCompany: COMPANY, entityId: 1, reachable: null }),
    ]);
    expect(connector.nextKeyHint).toBeNull();
  });

  it('refuses anyone without admin.integrations.write, and an agent', async () => {
    const key = newConnectorKey();
    for (const who of [accounts, principalFor('agent:chief', [1])]) {
      expect(
        await failure(
          executeCommand(who, { entityIds: [1] }, registerTallyConnector, {
            name: 'refused',
            keyHash: key.keyHash,
            keyHint: key.keyHint,
          }),
        ),
      ).toMatchObject({ code: 'forbidden' });
    }
  });

  it('maps a company only of the request, and a Tally company only once', async () => {
    expect(
      await failure(
        executeCommand(exec, { entityIds: [1] }, mapTallyCompany, {
          connectorId: connector.id,
          tallyCompany: SPARE,
          entityId: 3,
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await failure(
        executeCommand(exec, { entityIds: [1] }, mapTallyCompany, {
          connectorId: connector.id,
          tallyCompany: COMPANY,
          entityId: 1,
        }),
      ),
    ).toMatchObject({ code: 'conflict', reason: 'tally_company_already_mapped' });
  });

  it('rotates: both keys verify until the old one is retired', async () => {
    const next = newConnectorKey();
    const rotated = await executeCommand(exec, { entityIds: [1] }, rotateTallyConnectorKey, {
      connectorId: connector.id,
      keyHash: next.keyHash,
      keyHint: next.keyHint,
    });
    expect(rotated.nextKeyHint).toBe(next.keyHint);
    const during = await withRequestContext(connectorPrincipal([]), { entityIds: [] }, (ctx) =>
      findTallyConnector(ctx, connector.id),
    );
    expect(during?.signingKeys).toHaveLength(2);
    expect(during?.signingKeys).toContain(connectorSigningKey(next.key));
    const retired = await executeCommand(exec, { entityIds: [1] }, retireTallyConnectorKey, {
      connectorId: connector.id,
    });
    expect(retired).toMatchObject({ keyHint: next.keyHint, nextKeyHint: null });
    const after = await withRequestContext(connectorPrincipal([]), { entityIds: [] }, (ctx) =>
      findTallyConnector(ctx, connector.id),
    );
    expect(after?.signingKeys).toEqual([next.keyHash]);
    expect(
      await failure(
        executeCommand(exec, { entityIds: [1] }, retireTallyConnectorKey, {
          connectorId: connector.id,
        }),
      ),
    ).toMatchObject({ code: 'conflict', reason: 'tally_connector_no_next_key' });
  });
});

describe('tally.batch.ingest', () => {
  const firstKey = newId();
  let first: unknown;

  it('refuses a person, and a company not mapped to the connector', async () => {
    expect(
      await failure(
        executeCommand(accounts, { entityIds: [1] }, ingestTallyBatch, batch(0, 1, [])),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await failure(
        executeCommand(connectorPrincipal([1, 2]), { entityIds: [2] }, ingestTallyBatch, {
          entityId: 2,
          batch: { ...batch(0, 1, []).batch, entityCode: 'SMP' },
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    // A company outside the connector's principal.
    expect(
      await failure(
        executeCommand(connectorPrincipal([1]), { entityIds: [3] }, ingestTallyBatch, {
          entityId: 3,
          batch: { ...batch(0, 1, []).batch, entityCode: 'ASH' },
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('stores a batch, purchases in the restricted table, and moves the cursor', async () => {
    first = await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      ingestTallyBatch,
      batch(0, 10, [voucher(1, 3), voucher(2, 5, 'purchase'), voucher(3, 9, 'receipt')]),
      { idempotencyKey: firstKey },
    );
    expect(first).toEqual({
      company: COMPANY,
      accepted: { vouchersNew: 3, vouchersChanged: 0, vouchersUnchanged: 0, ledgers: 0 },
      lastAlterId: 10,
    });
    expect(await stateOf('tally_vouchers', guid(1))).toBe('received');
    expect(await stateOf('tally_purchase_vouchers', guid(2))).toBe('received');
    expect(await stateOf('tally_vouchers', guid(2))).toBeUndefined();
    const cursor = await withRequestContext(connectorPrincipal(), { entityIds: [1] }, (ctx) =>
      readTallyCursor(ctx, { entityId: 1, company: COMPANY }),
    );
    expect(cursor.lastAlterId).toBe(10);
  });

  it('answers a resend under the same key from the first call and applies it once', async () => {
    const again = await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      ingestTallyBatch,
      batch(0, 10, [voucher(1, 3), voucher(2, 5, 'purchase'), voucher(3, 9, 'receipt')]),
      { idempotencyKey: firstKey },
    );
    expect(again).toEqual(first);
    const [audits] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from audit_logs
        where actor_principal_id = ${connector.id} and command = 'tally.batch.ingest'
          and outcome = 'ok'`,
    );
    expect(audits?.n).toBe(1);
  });

  it('answers cursor_mismatch to a resend under another key, and to a gap', async () => {
    for (const from of [0, 15]) {
      expect(
        await failure(
          executeCommand(
            connectorPrincipal(),
            { entityIds: [1] },
            ingestTallyBatch,
            batch(from, 20, [voucher(4, 20)]),
            { idempotencyKey: newId() },
          ),
        ),
      ).toMatchObject({ code: 'conflict', reason: 'cursor_mismatch' });
    }
  });

  it('alters a changed voucher and stores its ledgers', async () => {
    const out = await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      ingestTallyBatch,
      batch(
        10,
        20,
        [{ ...voucher(1, 12), voucherNo: 'TC2/1 changed' }],
        [
          {
            guid: guid(100),
            alterId: 15,
            name: 'Kisan Agro Traders',
            parent: 'Sundry Debtors',
            gstin: null,
            openingBalance: '0.00',
            closingBalance: '-5000.00',
            asOf: '2026-09-27',
          },
        ],
      ),
      { idempotencyKey: newId() },
    );
    expect(out.accepted).toEqual({
      vouchersNew: 0,
      vouchersChanged: 1,
      vouchersUnchanged: 0,
      ledgers: 1,
    });
    const [row] = await asMigrator(
      (m) => m<{ voucher_no: string; state: string }[]>`
        select voucher_no, state from tally_vouchers where guid = ${guid(1)}`,
    );
    expect(row).toEqual({ voucher_no: 'TC2/1 changed', state: 'received' });
  });
});

describe('tally.snapshot.record and tally.snapshot.confirm', () => {
  const asOf = () => new Date(Date.now() + 60_000).toISOString();

  it('tombstones a stored voucher missing from the snapshot and names those it lacks', async () => {
    const out = await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      recordTallySnapshot,
      {
        entityId: 1,
        snapshot: {
          company: COMPANY,
          entityCode: 'SS',
          asOf: asOf(),
          fromDate: '2026-04-01',
          voucherGuids: [guid(1), guid(2), guid(50)],
        },
        ledgerBalances: [
          {
            guid: guid(100),
            name: 'Kisan Agro Traders',
            closingBalance: '-7000.00',
            asOf: '2026-09-28',
          },
          // A ledger no batch has brought yet waits for its batch.
          { guid: guid(101), name: 'Unknown party', closingBalance: '10.00', asOf: '2026-09-28' },
        ],
      },
    );
    expect(out.state).toBe('applied');
    expect(out.response).toEqual({
      company: COMPANY,
      known: 2,
      tombstoned: 1,
      missingOnServer: [guid(50)],
    });
    expect(await stateOf('tally_vouchers', guid(3))).toBe('tombstoned');
    const [tomb] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from tally_voucher_tombstones
        where voucher_guid = ${guid(3)} and snapshot_id = ${out.snapshotId}`,
    );
    expect(tomb?.n).toBe(1);
    const [snap] = await asMigrator(
      (m) => m<{ missing_guids: string[] }[]>`
        select missing_guids from tally_snapshots where id = ${out.snapshotId}`,
    );
    expect(snap?.missing_guids).toEqual([guid(50)]);
    const [ledger] = await asMigrator(
      (m) => m<{ closing_balance: string; as_of: string }[]>`
        select closing_balance, as_of::text as as_of from tally_ledgers where guid = ${guid(100)}`,
    );
    expect(ledger).toEqual({ closing_balance: '-7000.00', as_of: '2026-09-28' });
  });

  it('holds a snapshot over the limits for Accounts, who confirm it once', async () => {
    // Thirty more sales: an empty snapshot would remove all of them and the two left.
    const many = Array.from({ length: 30 }, (_, i) => voucher(200 + i, 21 + i));
    await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      ingestTallyBatch,
      batch(20, 60, many),
      {
        idempotencyKey: newId(),
      },
    );
    const held = await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      recordTallySnapshot,
      {
        entityId: 1,
        snapshot: {
          company: COMPANY,
          entityCode: 'SS',
          asOf: asOf(),
          fromDate: '2026-04-01',
          voucherGuids: [],
        },
      },
    );
    expect(held.state).toBe('held');
    expect(held.response.tombstoned).toBe(0);
    expect(await stateOf('tally_vouchers', guid(200))).toBe('received');

    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    expect(
      await failure(
        executeCommand(caller, { entityIds: [1] }, confirmTallySnapshot, {
          entityId: 1,
          snapshotId: held.snapshotId,
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    const elsewhere = await createTestPrincipal('accounts', [2]);
    expect(
      await failure(
        executeCommand(elsewhere, { entityIds: [2] }, confirmTallySnapshot, {
          entityId: 2,
          snapshotId: held.snapshotId,
        }),
      ),
    ).toMatchObject({ code: 'not_found' });

    const confirmed = await executeCommand(accounts, { entityIds: [1] }, confirmTallySnapshot, {
      entityId: 1,
      snapshotId: held.snapshotId,
    });
    // The thirty sales, the first sale and the purchase; the receipt was a tombstone already.
    expect(confirmed.tombstoned).toBe(32);
    expect(await stateOf('tally_vouchers', guid(200))).toBe('tombstoned');
    expect(await stateOf('tally_purchase_vouchers', guid(2))).toBe('tombstoned');
    expect(
      await failure(
        executeCommand(accounts, { entityIds: [1] }, confirmTallySnapshot, {
          entityId: 1,
          snapshotId: held.snapshotId,
        }),
      ),
    ).toMatchObject({ code: 'conflict', reason: 'tally_snapshot_not_held' });
  });
});

describe('tally.heartbeat.record', () => {
  it('records the connector’s report for its mapped companies only', async () => {
    const out = await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      recordTallyHeartbeat,
      {
        heartbeat: {
          connectorVersion: '1.0.0',
          tallyVersion: 'TallyPrime 5.1',
          companies: [
            { name: COMPANY, lastAlterId: 61, reachable: true },
            { name: SPARE, lastAlterId: 3, reachable: false },
          ],
          queueDepth: 2,
        },
      },
    );
    expect(out).toEqual({ companies: 1 });
    const [row] = await asMigrator(
      (m) => m<{ v: string; q: number; at: Date | null; reported: string }[]>`
        select c.connector_version as v, c.queue_depth as q, c.last_heartbeat_at as at,
               m.reported_alter_id as reported
          from tally_connectors c join tally_connector_companies m on m.connector_id = c.id
         where c.id = ${connector.id}`,
    );
    expect(row).toMatchObject({ v: '1.0.0', q: 2, reported: '61' });
    expect(row?.at).not.toBeNull();
    expect(
      await failure(
        executeCommand(accounts, { entityIds: [1] }, recordTallyHeartbeat, {
          heartbeat: {
            connectorVersion: '1.0.0',
            tallyVersion: 'x',
            companies: [{ name: COMPANY, lastAlterId: 1, reachable: true }],
            queueDepth: 0,
          },
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });
});

describe('unmap and revoke', () => {
  it('unmaps a company, then revokes the connector, whose keys stop working', async () => {
    const unmapped = await executeCommand(exec, { entityIds: [1] }, unmapTallyCompany, {
      connectorId: connector.id,
      entityId: 1,
    });
    expect(unmapped.companies).toEqual([]);
    connector = await executeCommand(exec, { entityIds: [1] }, revokeTallyConnector, {
      connectorId: connector.id,
    });
    expect(connector.revokedAt).not.toBeNull();
    expect(
      await withRequestContext(connectorPrincipal([]), { entityIds: [] }, (ctx) =>
        findTallyConnector(ctx, connector.id),
      ),
    ).toBeUndefined();
    expect(
      await failure(
        executeCommand(connectorPrincipal(), { entityIds: [1] }, recordTallyHeartbeat, {
          heartbeat: {
            connectorVersion: '1.0.0',
            tallyVersion: 'x',
            companies: [{ name: COMPANY, lastAlterId: 1, reachable: true }],
            queueDepth: 0,
          },
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });
});
