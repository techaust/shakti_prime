import { ConnectorBatchRequest } from '@shakti/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { COMPANIES, FAST, harness, KEY, type Harness } from './harness';

const [SS, SMP] = COMPANIES as [(typeof COMPANIES)[number], (typeof COMPANIES)[number]];
let h: Harness;

afterEach(async () => {
  await h.close();
});

/** The ranges the BOS accepted for a company, in order: contiguous from 0 with nothing twice. */
function chain(company: string): [number, number][] {
  return h.bos.batches.filter((b) => b.company === company).map((b) => [b.from, b.to]);
}

function expectContiguous(company: string, upTo: number): void {
  let at = 0;
  for (const [from, to] of chain(company)) {
    expect(from).toBe(at);
    expect(to).toBeGreaterThan(from);
    at = to;
  }
  expect(at).toBe(upTo);
}

describe('a cycle', () => {
  it('reads each company from the BOS cursor in pages and marks each page sent on the answer', async () => {
    h = await harness();
    for (let i = 0; i < 12; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.tally.addLedger(SS.name);
    for (let i = 0; i < 3; i += 1) h.tally.addVoucher(SMP.name, { type: 'Receipt' });

    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expect(chain(SS.name)).toEqual([
      [0, 5],
      [5, 10],
      [10, 13],
    ]);
    expect(chain(SMP.name)).toEqual([[0, 3]]);
    expect(h.bos.applied.filter((a) => a.company === SS.name)).toHaveLength(12);
    expect(h.outbox.depth()).toBe(0);
    expect(h.bos.refusedSignatures).toEqual([]);

    // Nothing new: the next cycle asks the cursor and the company state, and sends nothing.
    const before = h.tally.requests.length;
    await h.syncer.cycle();
    expect(h.bos.batches).toHaveLength(4);
    expect(h.tally.requests.slice(before).map((q) => q.collection)).toEqual([
      'BOSCompanyStatus',
      'BOSCompanyStatus',
    ]);
  });

  it('sends what leaves the PC as the contract says, and logs ids and counts only', async () => {
    h = await harness();
    h.tally.addVoucher(SS.name, {
      type: 'Sales',
      gstin: '08AAAAA0000A1Z5',
      buyerOrderNo: 'SS/SO/1',
    });
    h.tally.addLedger(SS.name, { name: 'Kisan Agro Traders' });
    await h.syncer.cycle();
    const batch = h.bos.bodies.find((b) => b.includes('"vouchers"'));
    expect(ConnectorBatchRequest.safeParse(JSON.parse(batch ?? '{}')).success).toBe(true);
    const logged = h.log.lines.join('\n');
    expect(logged).not.toContain(KEY);
    expect(logged).not.toMatch(/Party|Kisan|Shakti|1001\.00|-1001|SS\/SO/);
    for (const line of h.log.lines) {
      for (const value of Object.values(JSON.parse(line) as Record<string, unknown>)) {
        expect(['number', 'boolean', 'string'].includes(typeof value) || value === null).toBe(true);
      }
    }
  });
});

describe('a lost answer', () => {
  it('is asked again at once under the same key, and applied once', async () => {
    h = await harness();
    for (let i = 0; i < 7; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.bos.knobs.loseAnswers = 1;
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expect(h.bos.appliedTwice()).toEqual([]);
    expect(h.bos.applied).toHaveLength(7);
    expectContiguous(SS.name, 7);
  });

  it('resends the same batch under the same key next cycle, which the BOS applies once', async () => {
    h = await harness();
    for (let i = 0; i < 7; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.bos.knobs.loseAnswers = 2;

    // The first page is applied but its answer, and the answer to the quick retry, are lost: the
    // connector cannot tell, so the page stays pending and the cycle ends.
    await expect(h.syncer.cycle()).resolves.toBe('bos_unavailable');
    expect(h.outbox.depth()).toBe(1);
    const [pending] = h.outbox.pending();
    expect(h.bos.applied).toHaveLength(5);

    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expect(h.bos.appliedTwice()).toEqual([]);
    expect(h.bos.applied).toHaveLength(7);
    expectContiguous(SS.name, 7);
    // The resend carried the stored key and body; the BOS answered from its idempotency store.
    expect(h.bos.batches[0]?.key).toBe(pending?.idempotencyKey);
    expect(h.bos.bodies.filter((b) => b === pending?.body)).toHaveLength(3);
    expect(h.outbox.depth()).toBe(0);
  });

  it('sets the queued pages aside and reads again when the BOS cursor moved on', async () => {
    h = await harness();
    for (let i = 0; i < 4; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.bos.knobs.loseAnswers = 2;
    await h.syncer.cycle();
    expect(h.outbox.depth()).toBe(1);
    // Days later the BOS no longer holds the key: the resend meets a cursor past it.
    h.bos.knobs.loseAnswers = 0;
    const stored = h.bos.cursors.get(SS.name);
    expect(stored).toBe(4);
    (h.bos as unknown as { keys: Map<string, unknown> }).keys.clear();
    h.tally.alterVoucher(SS.name, h.tally.vouchersOf(SS.name)[0]?.guid ?? '');

    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expect(h.outbox.depth()).toBe(0);
    expect(h.bos.appliedTwice()).toEqual([]);
    expectContiguous(SS.name, 5);
    expect(h.log.lines.some((l) => l.includes('batches_superseded'))).toBe(true);
  });
});

describe('a three-day outage', () => {
  it('catches up in order, with every change once and nothing lost, and the day snapshot after', async () => {
    h = await harness({ now: new Date('2026-11-24T05:00:00Z') });
    const day = (n: number, hour = 5) =>
      new Date(Date.UTC(2026, 10, 24 + n, hour, 30)).toISOString();
    for (let i = 0; i < 6; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    await h.syncer.cycle();
    expectContiguous(SS.name, 6);

    // The office's internet goes down for three days; Accounts keeps working in Tally.
    h.bos.knobs.down = true;
    const deleted = h.tally.vouchersOf(SS.name)[1]?.guid ?? '';
    for (let d = 0; d < 3; d += 1) {
      for (let hour = 4; hour < 14; hour += 3) {
        h.clock.now = new Date(day(d, hour));
        h.tally.addVoucher(SS.name, { type: hour % 2 === 0 ? 'Sales' : 'Receipt' });
        const first = h.tally.vouchersOf(SS.name)[0];
        if (first !== undefined) h.tally.alterVoucher(SS.name, first.guid);
        h.tally.addVoucher(SMP.name, { type: 'Credit Note' });
        await expect(h.syncer.cycle()).resolves.toBe('bos_unavailable');
        await expect(h.syncer.heartbeat()).resolves.toBe(false);
      }
    }
    h.tally.deleteVoucher(SS.name, deleted);
    // Nothing was read while the BOS did not answer, so nothing waits in the outbox.
    expect(h.outbox.depth()).toBe(0);
    expect(h.bos.batches).toHaveLength(2);

    h.bos.knobs.down = false;
    h.clock.now = new Date(day(3, 5));
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');

    expectContiguous(SS.name, h.tally.lastAlterId(SS.name));
    expectContiguous(SMP.name, h.tally.lastAlterId(SMP.name));
    expect(h.bos.appliedTwice()).toEqual([]);
    // Every voucher Tally holds reached the BOS at its latest version, oldest change first.
    for (const company of [SS.name, SMP.name]) {
      const applied = h.bos.applied.filter((a) => a.company === company);
      expect(applied.map((a) => a.alterId)).toEqual(
        [...applied.map((a) => a.alterId)].sort((a, b) => a - b),
      );
      for (const voucher of h.tally.vouchersOf(company)) {
        expect(applied.at(applied.findLastIndex((a) => a.guid === voucher.guid))?.alterId).toBe(
          voucher.alterId,
        );
      }
    }
    // The first day's snapshots went before the outage; none was read while the BOS did not
    // answer; one per company for the day it came back, without the voucher deleted in Tally.
    const after = h.bos.snapshots.slice(2);
    expect(after.map((s) => s.entityCode)).toEqual(['SS', 'SMP']);
    expect(after[0]?.voucherGuids).not.toContain(deleted);
    expect(after[0]?.voucherGuids).toHaveLength(h.tally.vouchersOf(SS.name).length);
    await h.syncer.cycle();
    expect(h.bos.snapshots).toHaveLength(4);
  });

  it('resends the pages queued when the BOS went down part-way through a catch-up', async () => {
    h = await harness();
    for (let i = 0; i < 14; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.bos.knobs.loseAnswers = 4;
    await expect(h.syncer.cycle()).resolves.toBe('bos_unavailable');
    await expect(h.syncer.cycle()).resolves.toBe('bos_unavailable');
    expect(h.outbox.depth()).toBe(1);
    h.restart();
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 14);
    expect(h.bos.appliedTwice()).toEqual([]);
  });
});

describe('the daily snapshot and the heartbeat', () => {
  it('sends the snapshot and the dealer balances after 02:00 India time once a day, with asOf before the read began', async () => {
    h = await harness({ now: new Date('2026-11-26T20:00:00Z') }); // 01:30 in India
    h.tally.addVoucher(SS.name, { type: 'Sales', date: '20250115' });
    h.tally.addVoucher(SS.name, { type: 'Journal' });
    const dealer = h.tally.addLedger(SS.name, { name: 'Kisan Agro Traders' });
    await h.syncer.cycle();
    h.tally.setClosing(SS.name, dealer.guid, -76500);
    expect(h.bos.snapshots).toHaveLength(0);

    h.clock.now = new Date('2026-11-26T20:31:00Z'); // 02:01
    await h.syncer.cycle();
    expect(h.bos.snapshots).toHaveLength(2);
    expect(h.bos.snapshots[0]).toMatchObject({
      company: SS.name,
      entityCode: 'SS',
      asOf: '2026-11-26T20:26:00.000Z',
      fromDate: '2025-01-15',
      voucherGuids: [h.tally.vouchersOf(SS.name)[0]?.guid],
      ledgerBalances: [
        {
          guid: dealer.guid,
          name: 'Kisan Agro Traders',
          closingBalance: '-76500.00',
          asOf: '2026-11-27',
        },
      ],
    });
    expect(h.log.lines.join('\n')).not.toMatch(/Kisan|76500/);
    h.clock.now = new Date('2026-11-27T05:00:00Z');
    await h.syncer.cycle();
    expect(h.bos.snapshots).toHaveLength(2);
    h.clock.now = new Date('2026-11-27T20:40:00Z');
    await h.syncer.cycle();
    expect(h.bos.snapshots).toHaveLength(4);
  });

  it('reports each company, the queue and Tally from the last cycle, without asking Tally', async () => {
    h = await harness();
    h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.tally.setOpen(SMP.name, false);
    await h.syncer.cycle();
    const before = h.tally.requests.length;
    await expect(h.syncer.heartbeat()).resolves.toBe(true);
    expect(h.tally.requests).toHaveLength(before);
    expect(h.bos.heartbeats.at(-1)).toEqual({
      connectorVersion: '0.1.0',
      tallyVersion: 'TallyPrime 5.1',
      companies: [
        { name: SS.name, lastAlterId: 1, reachable: true, tallyLastAlterId: 1 },
        { name: SMP.name, lastAlterId: 0, reachable: false },
      ],
      queueDepth: 0,
      heldRows: 0,
    });
  });

  it('waits for a person when Tally is behind the BOS (a restored backup)', async () => {
    h = await harness();
    h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.bos.cursors.set(SS.name, 40);
    await h.syncer.readCompany(SS);
    expect(h.bos.batches).toHaveLength(0);
    expect(h.log.lines.some((l) => l.includes('tally_behind_bos'))).toBe(true);
  });
});

describe('a BOS that answers without taking a row', () => {
  it('holds only that company while it refuses its batch, and the other company goes on', async () => {
    h = await harness();
    for (let i = 0; i < 3; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    for (let i = 0; i < 2; i += 1) h.tally.addVoucher(SMP.name, { type: 'Receipt' });
    h.bos.knobs.refuseBatchesOf.set(SS.name, 403);

    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expect(chain(SMP.name)).toEqual([[0, 2]]);
    expect(chain(SS.name)).toEqual([]);
    const [waiting] = h.outbox.pending();
    expect(waiting).toMatchObject({ company: SS.name, refusals: 1 });

    // Next cycle: the same row is tried again, nothing more of the company is read, and the
    // other company's new voucher still goes.
    h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.tally.addVoucher(SMP.name, { type: 'Receipt' });
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expect(chain(SMP.name)).toEqual([
      [0, 2],
      [2, 3],
    ]);
    expect(h.outbox.pending()).toEqual([{ ...waiting, attempts: 2, refusals: 2 }]);
    expect(
      h.tally.requests.filter((q) => q.company === SS.name && q.collection === 'BOSVouchers'),
    ).toHaveLength(1);
    await h.syncer.heartbeat();
    expect(h.bos.heartbeats.at(-1)?.companies[0]).toEqual({
      name: SS.name,
      lastAlterId: 0,
      reachable: true,
      tallyLastAlterId: 4,
      problem: 'waiting_on_bos',
    });

    // Once the BOS takes it, the company catches up in order.
    h.bos.knobs.refuseBatchesOf.clear();
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 4);
    expect(h.bos.batches.find((b) => b.company === SS.name)?.key).toBe(waiting?.idempotencyKey);
    await h.syncer.heartbeat();
    expect(h.bos.heartbeats.at(-1)?.companies[0]).toEqual({
      name: SS.name,
      lastAlterId: 4,
      reachable: true,
      tallyLastAlterId: 4,
    });
  });

  it('sets a refused batch aside after its attempts, reports it, and reads again from the cursor', async () => {
    h = await harness();
    for (let i = 0; i < 3; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.bos.knobs.refuseBatchesOf.set(SS.name, 403);
    for (let i = 0; i < 3; i += 1) await h.syncer.cycle();
    expect(h.outbox.heldCount()).toBe(1);
    // The same cycle read the company again from the BOS's cursor, under a new key.
    const [again] = h.outbox.pending();
    expect(again).toMatchObject({ company: SS.name, fromAlterId: 0, refusals: 1 });
    const held = h.log.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(held.find((l) => l.event === 'outbox_row_held')).toMatchObject({
      entity: 'SS',
      kind: 'batch',
      code: 'forbidden',
    });
    await h.syncer.heartbeat();
    expect(h.bos.heartbeats.at(-1)?.heldRows).toBe(1);

    h.bos.knobs.refuseBatchesOf.clear();
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 3);
    expect(h.bos.batches[0]?.key).toBe(again?.idempotencyKey);
    expect(h.bos.appliedTwice()).toEqual([]);
    // Set-aside rows go after the days kept, as sent ones do.
    h.clock.now = new Date(h.clock.now.getTime() + 8 * 24 * 60 * 60_000);
    await h.syncer.cycle();
    expect(h.outbox.heldCount()).toBe(0);
  });

  it('asks again after an answer it cannot read, and goes on with the other company meanwhile', async () => {
    h = await harness();
    for (let i = 0; i < 2; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.tally.addVoucher(SMP.name, { type: 'Receipt' });
    // One unreadable answer is asked again at once.
    h.bos.knobs.garbleNext = 1;
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expect(h.bos.calls.slice(0, 2)).toEqual([
      'GET /api/v1/connector/tally/cursor',
      'GET /api/v1/connector/tally/cursor',
    ]);
    expectContiguous(SS.name, 2);
    expectContiguous(SMP.name, 1);

    // The BOS applies the next batch, but both answers to it are unreadable: the row waits for
    // the next cycle and the other company is still read and sent.
    h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.tally.addVoucher(SMP.name, { type: 'Receipt' });
    h.bos.knobs.garbleBatchAnswers = 2;
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SMP.name, 2);
    expect(h.outbox.pending()).toMatchObject([{ company: SS.name, attempts: 1, refusals: 1 }]);
    expect(h.log.lines.some((l) => l.includes('bos_answer_unreadable'))).toBe(true);

    // The resend under the same key gets the BOS's stored answer: applied once, marked sent.
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 3);
    expect(h.outbox.depth()).toBe(0);
    expect(h.bos.appliedTwice()).toEqual([]);

    // A cursor it cannot read twice over leaves that company for the next cycle only.
    h.tally.addVoucher(SMP.name, { type: 'Receipt' });
    h.bos.knobs.garbleNext = 2;
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SMP.name, 3);
  });

  it.each([
    { first: 'refused', later: 'unreadable' },
    { first: 'unreadable', later: 'refused' },
  ] as const)(
    'goes on past a $first row in the drain and sends the later $later one once the BOS takes it',
    async ({ first }) => {
      h = await harness();
      h.tally.addVoucher(SS.name, { type: 'Sales' });
      h.tally.addVoucher(SMP.name, { type: 'Receipt' });
      // Cycle 1: both companies' first batch stays pending, one refused and one answered unreadably.
      const refusedCompany = first === 'refused' ? SS.name : SMP.name;
      h.bos.knobs.refuseBatchesOf.set(refusedCompany, 403);
      h.bos.knobs.garbleBatchAnswers = 2;
      await expect(h.syncer.cycle()).resolves.toBe('caught_up');
      const [firstRow, laterRow] = h.outbox.pending();
      expect([firstRow?.company, laterRow?.company]).toEqual([SS.name, SMP.name]);

      // Cycle 2: the first row still fails as it did; the later one is now taken by the BOS.
      if (first === 'refused') {
        h.bos.knobs.garbleBatchAnswers = 0;
      } else {
        h.bos.knobs.refuseBatchesOf.clear();
        h.bos.knobs.garbleBatchAnswers = 2;
      }
      const from = h.bos.calls.length;
      await expect(h.syncer.cycle()).resolves.toBe('caught_up');
      const calls = h.bos.calls.slice(from);
      // The later row went from the drain, before any company was read.
      expect(calls.slice(0, 2)).toEqual([
        'POST /api/v1/connector/tally/batches',
        'POST /api/v1/connector/tally/batches',
      ]);
      expect(h.outbox.pending()).toEqual([{ ...firstRow, attempts: 2, refusals: 2 }]);
      expectContiguous(SMP.name, 1);
      expect(h.bos.appliedTwice()).toEqual([]);
    },
  );

  it('sets a row aside after its attempts when every answer to it is unreadable', async () => {
    h = await harness({ companies: [SS] });
    for (let i = 0; i < 2; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    // Two calls per send (one quick retry), three sends: every answer the BOS gives is unreadable.
    h.bos.knobs.garbleBatchAnswers = 2 * FAST.outboxMaxAttempts;
    for (let i = 0; i < FAST.outboxMaxAttempts; i += 1) {
      await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    }
    expect(h.outbox.depth()).toBe(0);
    expect(h.outbox.heldCount()).toBe(1);
    const held = h.log.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(held.find((l) => l.event === 'outbox_row_held')).toMatchObject({
      entity: 'SS',
      kind: 'batch',
      code: 'bad_answer',
    });
    await h.syncer.heartbeat();
    expect(h.bos.heartbeats.at(-1)?.heldRows).toBe(1);
    // The BOS applied it the first time: the company goes on from its cursor, nothing twice.
    h.tally.addVoucher(SS.name, { type: 'Sales' });
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 3);
    expect(h.bos.appliedTwice()).toEqual([]);
  });

  it('syncs a BOS whose answers carry fields this build does not know', async () => {
    h = await harness({ now: new Date('2026-11-26T20:31:00Z') });
    for (let i = 0; i < 7; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.bos.knobs.extraFields = true;
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 7);
    expect(h.bos.snapshots).toHaveLength(2);
    expect(h.outbox.depth()).toBe(0);
    await expect(h.syncer.heartbeat()).resolves.toBe(true);
  });
});

describe('a refused snapshot', () => {
  it('is tried each cycle up to its attempts, replaced by the next day’s, and never sent beside it', async () => {
    h = await harness({ companies: [SS], now: new Date('2026-11-26T20:31:00Z') });
    h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.bos.knobs.refuseSnapshots = 413;
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 1);
    const [first] = h.outbox.pending();
    expect(first).toMatchObject({ kind: 'snapshot', refusals: 1 });

    h.clock.now = new Date('2026-11-27T05:00:00Z');
    h.tally.addVoucher(SS.name, { type: 'Sales' });
    await h.syncer.cycle();
    // Tried again, and the company's batches were not held by it.
    expect(h.outbox.pending()).toEqual([{ ...first, attempts: 2, refusals: 2 }]);
    expectContiguous(SS.name, 2);

    // The next day's snapshot replaces the one still waiting: one list goes, not two.
    h.clock.now = new Date('2026-11-27T20:40:00Z');
    const sentBefore = h.bos.calls.filter((c) => c.endsWith('/snapshot')).length;
    await h.syncer.cycle();
    const pending = h.outbox.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).not.toBe(first?.id);
    expect(h.bos.calls.filter((c) => c.endsWith('/snapshot')).length - sentBefore).toBe(1);
    const read = h.log.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(read.filter((l) => l.event === 'snapshot_read').at(-1)).toMatchObject({ replaced: 1 });

    // After its attempts it is set aside and counted.
    await h.syncer.cycle();
    await h.syncer.cycle();
    expect(h.outbox.depth()).toBe(0);
    expect(h.outbox.heldCount()).toBe(1);
    await h.syncer.heartbeat();
    expect(h.bos.heartbeats.at(-1)).toMatchObject({ queueDepth: 0, heldRows: 1 });
  });
});

describe('a company Tally gives no first day of the books for', () => {
  it('is never read, says why in the heartbeat, and the other company goes on', async () => {
    h = await harness();
    h.tally.setBooksFrom(SS.name, undefined);
    h.tally.addVoucher(SS.name, { type: 'Sales', date: '20250115' });
    h.tally.addVoucher(SMP.name, { type: 'Receipt' });
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expect(chain(SS.name)).toEqual([]);
    expectContiguous(SMP.name, 1);
    // Only its state was asked (by the read and by the day's snapshot): no voucher or ledger.
    expect(
      new Set(h.tally.requests.filter((q) => q.company === SS.name).map((q) => q.collection)),
    ).toEqual(new Set(['BOSCompanyStatus']));
    expect(h.log.lines.some((l) => l.includes('company_without_books_from'))).toBe(true);
    await h.syncer.heartbeat();
    expect(h.bos.heartbeats.at(-1)?.companies[0]).toEqual({
      name: SS.name,
      lastAlterId: 0,
      reachable: true,
      tallyLastAlterId: 1,
      problem: 'no_books_from',
    });

    h.tally.setBooksFrom(SS.name, '20240401');
    await h.syncer.cycle();
    expectContiguous(SS.name, 1);
    expect(h.bos.applied.filter((a) => a.company === SS.name)).toHaveLength(1);
  });
});

describe('adaptive windows', () => {
  it('widens the window over a stretch of other changes and narrows it over a dense one', async () => {
    h = await harness({
      companies: [SS],
      settings: { pageSize: 5, pageSizeMax: 40, pageGrowBelowRows: 2, pageShrinkAboveRows: 6 },
    });
    for (let i = 0; i < 2; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.tally.alterOtherMasters(SS.name, 120);
    for (let i = 0; i < 60; i += 1) h.tally.addVoucher(SS.name, { type: 'Receipt' });
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 182);
    expect(h.bos.applied).toHaveLength(62);
    // Up from 5 while pages come back nearly empty, capped at 40; halved after each dense page;
    // the last page ends at Tally's last AlterID. Fixed windows of 5 would take 37 pages.
    expect(chain(SS.name).map(([from, to]) => to - from)).toEqual([
      5, 5, 10, 20, 40, 40, 40, 20, 2,
    ]);
  });

  // 2,600 vouchers through the fixture server: past vitest's 5-second default on CI's runners.
  it('reads a stretch again narrower when it holds more refused rows than a batch carries', async () => {
    h = await harness({
      companies: [SS],
      settings: {
        pageSize: 100,
        pageSizeMax: 10_000,
        pageGrowBelowRows: 50,
        pageShrinkAboveRows: 400,
      },
    });
    h.tally.alterOtherMasters(SS.name, 3100);
    // A bulk import the contract refuses row by row: vouchers without ledger lines.
    for (let i = 0; i < 2600; i += 1)
      h.tally.addVoucher(SS.name, { type: 'Sales', noEntries: true });
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 5700);
    // (3100, 5700] held 2,600 refused rows, over the 2,500 a batch reports: read again as (3100, 4700].
    expect(chain(SS.name).map(([from, to]) => to - from)).toEqual([
      100, 200, 400, 800, 1600, 1600, 800, 200,
    ]);
    expect(h.log.lines.filter((l) => l.includes('page_narrowed'))).toHaveLength(1);
    expect(h.log.lines.some((l) => l.includes('batch_unreadable'))).toBe(false);
    const reported = h.bos.bodies
      .filter((b) => b.includes('"fromAlterId"'))
      .flatMap((b) => (JSON.parse(b) as { refused?: unknown[] }).refused ?? []);
    expect(reported).toHaveLength(2600);
  }, 30_000);

  it('reads a stretch again in a narrower window when it holds more than a batch carries', async () => {
    h = await harness({
      companies: [SS],
      settings: {
        pageSize: 100,
        pageSizeMax: 1000,
        pageGrowBelowRows: 50,
        pageShrinkAboveRows: 400,
      },
    });
    for (let i = 0; i < 10; i += 1) h.tally.addVoucher(SS.name, { type: 'Sales' });
    h.tally.alterOtherMasters(SS.name, 890);
    for (let i = 0; i < 600; i += 1) h.tally.addVoucher(SS.name, { type: 'Receipt' });
    await expect(h.syncer.cycle()).resolves.toBe('caught_up');
    expectContiguous(SS.name, 1500);
    expect(h.bos.appliedTwice()).toEqual([]);
    expect(h.bos.applied).toHaveLength(610);
    // (700, 1500] held 600 vouchers, over the 500 a batch carries: read again as (700, 1100].
    expect(chain(SS.name).map(([from, to]) => to - from)).toEqual([100, 200, 400, 400, 400]);
    const narrowed = h.log.lines.filter((l) => l.includes('page_narrowed'));
    expect(narrowed).toHaveLength(1);
  });
});
