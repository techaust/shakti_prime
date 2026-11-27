import { ConnectorBatchRequest } from '@shakti/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { COMPANIES, harness, KEY, type Harness } from './harness';

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
        { name: SS.name, lastAlterId: 1, reachable: true },
        { name: SMP.name, lastAlterId: 0, reachable: false },
      ],
      queueDepth: 0,
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
