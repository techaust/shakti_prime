import {
  newId,
  SYSTEM_MATRIX,
  SYSTEM_WORKERS_PRINCIPAL_ID,
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
  recordTallyAlert,
  recordTallyHeartbeat,
  recordTallySnapshot,
} from '../../src/commands/tally/ingest';
import {
  findTallyConnector,
  listHeldTallyVouchers,
  readTallyCursor,
} from '../../src/queries/tally/connector';
import { envelopeCipher, localKeyProvider } from '../../src/privacy/field-cipher';
import { newConnectorKey, openConnectorKeys } from '../../src/tally/connector-key';

/** The local field cipher a developer's machine and CI seal with (a test phrase's bytes). */
const cipher = envelopeCipher(localKeyProvider(Buffer.alloc(32, 11).toString('base64')));
const sealing = { fieldCipher: cipher };

// TC2 Tally ingest on real Postgres (docs/03-roadmap-appendix/phase5.md §6.3, §13): an Executive
// registers and maps a connector; the connector's batches move the cursor forward once each, a
// resend under its key is answered from the first call, a gap answers cursor_mismatch; a snapshot
// within its limits tombstones at once and one over them waits for Accounts; the heartbeat records
// what the connector reports. Every assertion reads this run's own connector and companies.

afterAll(closeDb);

const RUN = newId().slice(-8);
const COMPANY = `TC2 ${RUN} Shakti Supreme`;
const SPARE = `TC2 ${RUN} Agro Solar`;
/** The same group company's next financial year, a Tally company of its own. */
const NEXT_YEAR = `TC2 ${RUN} Shakti Supreme 2027-28`;
let exec: Principal;
let accounts: Principal;
let connector: TallyConnectorDto;
let firstKey: string;

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
  firstKey = key.key;
  connector = await executeCommand(
    exec,
    { entityIds: [1, 2, 3, 4] },
    registerTallyConnector,
    { name: `TC2 test ${RUN}`, key: key.key },
    sealing,
  );
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
  it('registers a connector with its key sealed, never in the clear, and maps a company', async () => {
    const [row] = await asMigrator(
      (m) => m<{ sealed: string }[]>`
        select key_sealed::text as sealed from tally_connectors where id = ${connector.id}`,
    );
    expect(row?.sealed).not.toContain(firstKey);
    const auth = await withRequestContext(connectorPrincipal([]), { entityIds: [] }, (ctx) =>
      findTallyConnector(ctx, connector.id),
    );
    expect(await openConnectorKeys(cipher, connector.id, auth?.sealedKeys ?? [])).toEqual([
      firstKey,
    ]);
    // Sealed for its own connector: it does not open as another's.
    await expect(openConnectorKeys(cipher, newId(), auth?.sealedKeys ?? [])).rejects.toThrow();
    const [audit] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from audit_logs
         where command = 'tally.connector.register' and aggregate_id = ${connector.id}
           and (input_json::text like ${`%${firstKey}%`} or after_json::text like ${`%${firstKey}%`})`,
    );
    expect(audit?.n).toBe(0);
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
          executeCommand(
            who,
            { entityIds: [1] },
            registerTallyConnector,
            { name: 'refused', key: key.key },
            sealing,
          ),
        ),
      ).toMatchObject({ code: 'forbidden' });
    }
  });

  it('refuses a company outside the request, and maps a Tally company only once', async () => {
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

  it('refuses to keep a key on a runtime with no field cipher', async () => {
    expect(
      await failure(
        executeCommand(exec, { entityIds: [1] }, registerTallyConnector, {
          name: 'no cipher',
          key: newConnectorKey().key,
        }),
      ),
    ).toMatchObject({ code: 'integration_unavailable' });
  });

  it('rotates: both keys verify until the old one is retired', async () => {
    const next = newConnectorKey();
    const rotated = await executeCommand(
      exec,
      { entityIds: [1] },
      rotateTallyConnectorKey,
      { connectorId: connector.id, key: next.key },
      sealing,
    );
    expect(rotated.nextKeyHint).toBe(next.keyHint);
    const during = await withRequestContext(connectorPrincipal([]), { entityIds: [] }, (ctx) =>
      findTallyConnector(ctx, connector.id),
    );
    expect(await openConnectorKeys(cipher, connector.id, during?.sealedKeys ?? [])).toEqual([
      firstKey,
      next.key,
    ]);
    const retired = await executeCommand(exec, { entityIds: [1] }, retireTallyConnectorKey, {
      connectorId: connector.id,
    });
    expect(retired).toMatchObject({ keyHint: next.keyHint, nextKeyHint: null });
    const after = await withRequestContext(connectorPrincipal([]), { entityIds: [] }, (ctx) =>
      findTallyConnector(ctx, connector.id),
    );
    expect(await openConnectorKeys(cipher, connector.id, after?.sealedKeys ?? [])).toEqual([
      next.key,
    ]);
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
      held: [],
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

    // Tally checks list what the check would mark removed, a page at a time, never an amount;
    // a purchase only to those who read supplier rates.
    const pageOf = (principal: Principal, cursor?: string) =>
      withRequestContext(principal, { entityIds: [1] }, (ctx) =>
        listHeldTallyVouchers(ctx, {
          snapshotId: held.snapshotId,
          limit: 20,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
    const first = await pageOf(accounts);
    expect(first.total).toBe(32);
    expect(first.items).toHaveLength(20);
    // Its number, date, party and type, and nothing else: no amount.
    expect(Object.keys(first.items[0] ?? {}).sort()).toEqual([
      'guid',
      'partyName',
      'type',
      'voucherDate',
      'voucherNo',
    ]);
    expect(first.items[0]).toMatchObject({
      voucherDate: '2026-09-27',
      partyName: 'Kisan Agro Traders',
    });
    const second = await pageOf(accounts, first.nextCursor ?? undefined);
    expect(second.items).toHaveLength(12);
    expect(second.nextCursor).toBeNull();
    const seen = new Set([...first.items, ...second.items].map((v) => v.guid));
    expect(seen.size).toBe(32);
    expect(seen.has(guid(2))).toBe(true);
    const gm = await createTestPrincipal('general_manager', [1]);
    const gmPage = await pageOf(gm);
    expect(gmPage.total).toBe(31);

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
    // Confirmed, it is no longer listed.
    await expect(pageOf(accounts)).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'tally_snapshot_missing' },
    });
  });
});

describe('refused rows on a batch', () => {
  it('queues each for Accounts and takes the stored version out of matching until a later one', async () => {
    const cursor = await withRequestContext(connectorPrincipal(), { entityIds: [1] }, (ctx) =>
      readTallyCursor(ctx, { entityId: 1, company: COMPANY }),
    );
    const from = cursor.lastAlterId;
    await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      ingestTallyBatch,
      {
        ...batch(from, from + 5, []),
        batch: {
          ...batch(from, from + 5, []).batch,
          refused: [{ kind: 'voucher', guid: guid(1), alterId: from + 3, field: 'partyGstin' }],
        },
      },
      { idempotencyKey: newId() },
    );
    const read = () =>
      asMigrator(
        (m) => m<{ refused: boolean; open: number }[]>`
          select v.refused_at is not null as refused,
                 (select count(*)::int from tally_refused_rows f
                   where f.guid = v.guid and f.entity_id = 1 and f.resolved_at is null) as open
            from tally_vouchers v where v.guid = ${guid(1)}`,
      );
    expect((await read())[0]).toEqual({ refused: true, open: 1 });
    await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      ingestTallyBatch,
      batch(from + 5, from + 6, [{ ...voucher(1, from + 6), voucherNo: 'TC2/1 again' }]),
      { idempotencyKey: newId() },
    );
    expect((await read())[0]).toEqual({ refused: false, open: 0 });
  });
});

describe('rows held back from a batch', () => {
  const ledger = (n: number, alterId: number, parent = 'Sundry Debtors'): TallyLedger => ({
    guid: guid(n),
    alterId,
    name: 'Kisan Agro Traders',
    parent,
    gstin: null,
    openingBalance: '0.00',
    closingBalance: '-100.00',
    asOf: '2026-09-27',
  });
  const reviewRows = () =>
    asMigrator(
      (m) => m<{ guid: string; kind: string; reason: string; field: string }[]>`
        select guid, kind, reason, field from tally_refused_rows
         where connector_id = ${connector.id} and resolved_at is null
           and reason <> 'connector_refused' order by guid`,
    );

  it('holds a row in conflict for Accounts with its reason and applies the rest of the batch', async () => {
    // The next year's Tally company carries company 1's party ledger and a voucher already read
    // from the current year's; a creditor's ledger comes too. The batch applies without them.
    connector = await executeCommand(exec, { entityIds: [1] }, mapTallyCompany, {
      connectorId: connector.id,
      tallyCompany: NEXT_YEAR,
      entityId: 1,
    });
    const nextYear = (
      from: number,
      max: number,
      vouchers: TallyVoucher[],
      ledgers: TallyLedger[],
    ) => ({
      entityId: 1,
      batch: { ...batch(from, max, vouchers, ledgers).batch, company: NEXT_YEAR },
    });
    const out = await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      ingestTallyBatch,
      nextYear(
        0,
        10,
        [voucher(1, 4), voucher(300, 5)],
        [ledger(100, 6), ledger(102, 7, 'Sundry Creditors')],
      ),
      { idempotencyKey: newId() },
    );
    expect(out).toEqual({
      company: NEXT_YEAR,
      accepted: { vouchersNew: 1, vouchersChanged: 0, vouchersUnchanged: 0, ledgers: 0 },
      lastAlterId: 10,
      held: [
        { kind: 'voucher', guid: guid(1), alterId: 4, reason: 'other_company' },
        { kind: 'ledger', guid: guid(100), alterId: 6, reason: 'other_company' },
        { kind: 'ledger', guid: guid(102), alterId: 7, reason: 'not_debtor' },
      ],
    });
    expect(await stateOf('tally_vouchers', guid(300))).toBe('received');
    // The next batch is not stopped by the rows held before it.
    const next = await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      ingestTallyBatch,
      nextYear(10, 12, [voucher(301, 11)], []),
      { idempotencyKey: newId() },
    );
    expect(next).toMatchObject({ lastAlterId: 12, held: [] });
    expect(next.accepted.vouchersNew).toBe(1);
  });

  it('holds a voucher that moved between a sale and a purchase, its stored version not current', async () => {
    const cursor = await withRequestContext(connectorPrincipal(), { entityIds: [1] }, (ctx) =>
      readTallyCursor(ctx, { entityId: 1, company: COMPANY }),
    );
    const from = cursor.lastAlterId;
    const out = await executeCommand(
      connectorPrincipal(),
      { entityIds: [1] },
      ingestTallyBatch,
      batch(from, from + 2, [voucher(3, from + 1, 'purchase')]),
      { idempotencyKey: newId() },
    );
    expect(out.lastAlterId).toBe(from + 2);
    expect(out.held).toEqual([
      { kind: 'voucher', guid: guid(3), alterId: from + 1, reason: 'type_changed' },
    ]);
    expect(await stateOf('tally_purchase_vouchers', guid(3))).toBeUndefined();
    const [stored] = await asMigrator(
      (m) => m<{ refused: boolean }[]>`
        select refused_at is not null as refused from tally_vouchers where guid = ${guid(3)}`,
    );
    expect(stored?.refused).toBe(true);
    expect(await reviewRows()).toEqual(
      [
        { guid: guid(1), kind: 'voucher', reason: 'other_company', field: 'company' },
        { guid: guid(100), kind: 'ledger', reason: 'other_company', field: 'company' },
        { guid: guid(102), kind: 'ledger', reason: 'not_debtor', field: 'parent' },
        { guid: guid(3), kind: 'voucher', reason: 'type_changed', field: 'type' },
      ].sort((a, b) => a.guid.localeCompare(b.guid)),
    );
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
            { name: COMPANY, lastAlterId: 61, reachable: true, tallyLastAlterId: 70 },
            { name: SPARE, lastAlterId: 3, reachable: false },
          ],
          queueDepth: 2,
          heldRows: 1,
        },
      },
    );
    expect(out).toEqual({ companies: 1 });
    const [row] = await asMigrator(
      (m) => m<{ v: string; q: number; at: Date | null; reported: string }[]>`
        select c.connector_version as v, c.queue_depth as q, c.last_heartbeat_at as at,
               m.reported_alter_id as reported
          from tally_connectors c join tally_connector_companies m on m.connector_id = c.id
         where c.id = ${connector.id} and m.tally_company = ${COMPANY}`,
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

describe('tally.connector.unmap', () => {
  it('is refused to Accounts, and for a company outside the request', async () => {
    expect(
      await failure(
        executeCommand(accounts, { entityIds: [1] }, unmapTallyCompany, {
          connectorId: connector.id,
          entityId: 1,
          tallyCompany: COMPANY,
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await failure(
        executeCommand(exec, { entityIds: [1] }, unmapTallyCompany, {
          connectorId: connector.id,
          entityId: 2,
          tallyCompany: COMPANY,
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });
});

describe('unmap and revoke', () => {
  it('unmaps one Tally company, then revokes the connector, whose keys stop working', async () => {
    // The group company's other Tally company (its next year) stays linked.
    const unmapped = await executeCommand(exec, { entityIds: [1] }, unmapTallyCompany, {
      connectorId: connector.id,
      entityId: 1,
      tallyCompany: COMPANY,
    });
    expect(unmapped.companies.map((c) => c.tallyCompany)).toEqual([NEXT_YEAR]);
    const [audit] = await asMigrator(
      (m) => m<{ before: unknown }[]>`select before from audit_logs
        where aggregate_id = ${connector.id} and command = 'tally.connector.unmap'
          and outcome = 'ok' order by created_at desc limit 1`,
    );
    expect(audit?.before).toEqual({ tallyCompany: COMPANY });
    expect(
      await failure(
        executeCommand(exec, { entityIds: [1] }, unmapTallyCompany, {
          connectorId: connector.id,
          entityId: 1,
          tallyCompany: COMPANY,
        }),
      ),
    ).toMatchObject({ code: 'not_found', reason: 'tally_company_not_mapped' });
    const last = await executeCommand(exec, { entityIds: [1] }, unmapTallyCompany, {
      connectorId: connector.id,
      entityId: 1,
      tallyCompany: NEXT_YEAR,
    });
    expect(last.companies).toEqual([]);
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

describe('a snapshot in parts', () => {
  it('waits for every part, compares them together once, and drops none twice', async () => {
    const key = newConnectorKey();
    const own = await executeCommand(
      exec,
      { entityIds: [2] },
      registerTallyConnector,
      { name: `TC2 parts ${RUN}`, key: key.key },
      sealing,
    );
    const company = `TC2 ${RUN} parts`;
    await executeCommand(exec, { entityIds: [2] }, mapTallyCompany, {
      connectorId: own.id,
      tallyCompany: company,
      entityId: 2,
    });
    const self: Principal = { ...connectorPrincipal([2]), id: own.id };
    await executeCommand(
      self,
      { entityIds: [2] },
      ingestTallyBatch,
      {
        entityId: 2,
        batch: {
          company,
          entityCode: 'SMP',
          fromAlterId: 0,
          maxAlterId: 5,
          vouchers: [voucher(300, 1), voucher(301, 2), voucher(302, 3)],
          ledgers: [],
        },
      },
      { idempotencyKey: newId() },
    );
    const snapshotId = newId();
    const at = new Date(Date.now() + 60_000).toISOString();
    const send = (part: number, guids: string[]) =>
      executeCommand(self, { entityIds: [2] }, recordTallySnapshot, {
        entityId: 2,
        snapshot: {
          company,
          entityCode: 'SMP',
          asOf: at,
          fromDate: '2026-04-01',
          voucherGuids: guids,
          part: { snapshotId, part, parts: 2 },
        },
      });
    const first = await send(1, [guid(300)]);
    expect(first.state).toBe('receiving');
    expect(await stateOf('tally_vouchers', guid(302))).toBe('received');
    const last = await send(2, [guid(301)]);
    expect(last.snapshotId).toBe(first.snapshotId);
    expect(last).toMatchObject({ state: 'applied', response: { known: 2, tombstoned: 1 } });
    expect(await stateOf('tally_vouchers', guid(302))).toBe('tombstoned');
    const [row] = await asMigrator(
      (m) => m<{ state: string; guid_count: number; received: number }[]>`
        select state, guid_count, cardinality(received_guids) as received
          from tally_snapshots where id = ${last.snapshotId}`,
    );
    expect(row).toEqual({ state: 'applied', guid_count: 2, received: 0 });
    // A part of another shape is refused.
    expect(
      await failure(
        executeCommand(self, { entityIds: [2] }, recordTallySnapshot, {
          entityId: 2,
          snapshot: {
            company,
            entityCode: 'SMP',
            asOf: at,
            fromDate: '2026-04-01',
            voucherGuids: [],
            part: { snapshotId, part: 2, parts: 3 },
          },
        }),
      ),
    ).toMatchObject({ code: 'validation_failed', reason: 'tally_snapshot_part_mismatch' });
    await executeCommand(exec, { entityIds: [2] }, revokeTallyConnector, { connectorId: own.id });
  });
});

describe('tally.connector.record_alert', () => {
  it("is the jobs check's alone, and records when the alert went out", async () => {
    const workers: Principal = {
      ...principalFor('system:workers', []),
      id: SYSTEM_WORKERS_PRINCIPAL_ID,
    };
    expect(
      await failure(
        executeCommand(exec, { entityIds: [1] }, recordTallyAlert, {
          connectorId: connector.id,
          alert: 'silent',
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    const key = newConnectorKey();
    const other = await executeCommand(
      exec,
      { entityIds: [1] },
      registerTallyConnector,
      { name: `TC2 alert ${RUN}`, key: key.key },
      sealing,
    );
    const out = await executeCommand(workers, { entityIds: [] }, recordTallyAlert, {
      connectorId: other.id,
      alert: 'rows_held',
    });
    expect(out).toEqual({ recorded: true });
    const [row] = await asMigrator(
      (m) => m<{ alerted: boolean }[]>`
        select held_alerted_at is not null as alerted from tally_connectors where id = ${other.id}`,
    );
    expect(row?.alerted).toBe(true);
    await executeCommand(exec, { entityIds: [1] }, revokeTallyConnector, { connectorId: other.id });
  });
});
