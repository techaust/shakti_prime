import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryLog } from '../src/log';
import { TallyReader, TallyUnavailable, type ReaderSettings } from '../src/tally/reader';
import { FixtureTally } from './fixture-tally';
import { FAST } from './harness';

const COMPANY = 'Shakti Supreme Pvt Ltd';
let tally: FixtureTally;

beforeEach(async () => {
  tally = new FixtureTally();
  tally.addCompany(COMPANY);
  await tally.start();
});
afterEach(async () => {
  await tally.close();
});

function reader(settings: Partial<ReaderSettings> = {}, sleeps: number[] = []) {
  return new TallyReader({
    url: tally.url,
    settings: { ...FAST, ...settings },
    log: createMemoryLog(),
    sleep: (ms) => {
      sleeps.push(ms);
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
  });
}

describe('paging by AlterID', () => {
  it('reads one window of vouchers and party ledgers, in AlterID order, each once', async () => {
    for (let i = 0; i < 6; i += 1) tally.addVoucher(COMPANY, { type: 'Sales' });
    tally.addLedger(COMPANY, { gstin: '08AAAAA0000A1Z5' });
    tally.addVoucher(COMPANY, { type: 'Journal' });
    tally.addVoucher(COMPANY, { type: 'Receipt' });
    const first = tally.vouchersOf(COMPANY)[0];
    if (first === undefined) throw new Error('fixture');
    tally.alterVoucher(COMPANY, first.guid);
    const r = reader();
    const status = await r.companyStatus(COMPANY);
    expect(status).toEqual({ lastAlterId: 10, booksFrom: '20240401', tallyVersion: tally.version });

    const page = await r.readPage(COMPANY, status, 3, 10, '2026-11-27');
    // AlterIDs 4 to 10: vouchers 4, 5, 6 (sales), the ledger at 7, the journal at 8 (not read),
    // the receipt at 9 and the first voucher altered to 10.
    expect(page.vouchers.map((v) => [v.alterId, v.type])).toEqual([
      [4, 'sales'],
      [5, 'sales'],
      [6, 'sales'],
      [9, 'receipt'],
      [10, 'sales'],
    ]);
    expect(page.ledgers.map((l) => [l.alterId, l.gstin, l.closingBalance])).toEqual([
      [7, '08AAAAA0000A1Z5', '-5007.00'],
    ]);
    expect(page.refused).toEqual([]);
    // Six vouchers (the journal too) and the ledger came back: what the page cost Tally.
    expect(page.scanned).toBe(7);
    const asked = tally.requests.filter((q) => q.collection !== 'BOSCompanyStatus');
    expect(asked.map((q) => [q.collection, q.after, q.upTo])).toEqual([
      ['BOSVouchers', 3, 10],
      ['BOSLedgers', 3, 10],
    ]);
    expect(tally.requests.every((q) => q.tallyRequest === 'Export')).toBe(true);
  });

  it('reports a voucher the contract cannot carry by GUID and field, and logs no more', async () => {
    const odd = tally.addVoucher(COMPANY, { type: 'Sales', gstin: 'NOT-A-GSTIN' });
    tally.addVoucher(COMPANY, { type: 'Sales' });
    const log = createMemoryLog();
    const r = new TallyReader({ url: tally.url, settings: FAST, log });
    const status = await r.companyStatus(COMPANY);
    const page = await r.readPage(COMPANY, status, 0, 2, '2026-11-27');
    expect(page.vouchers.map((v) => v.alterId)).toEqual([2]);
    expect(page.refused).toEqual([
      { kind: 'voucher', guid: odd.guid, alterId: 1, field: 'partyGstin' },
    ]);
    expect(page.skipped).toBe(0);
    expect(log.lines).toHaveLength(1);
    expect(JSON.parse(log.lines[0] ?? '{}')).toMatchObject({
      event: 'voucher_unreadable',
      field: 'partyGstin',
      reported: true,
    });
    expect(log.lines[0]).not.toContain('NOT-A-GSTIN');
    expect(log.lines[0]).not.toContain('Party');
  });

  it('reports a cancelled voucher Tally gives without ledger lines, so the BOS hears of it', async () => {
    const sale = tally.addVoucher(COMPANY, { type: 'Sales' });
    const cancelled = tally.alterVoucher(COMPANY, sale.guid, { cancelled: true, noEntries: true });
    const r = reader();
    const status = await r.companyStatus(COMPANY);
    const page = await r.readPage(COMPANY, status, 1, 2, '2026-11-27');
    expect(page.vouchers).toEqual([]);
    expect(page.refused).toEqual([
      { kind: 'voucher', guid: sale.guid, alterId: cancelled.alterId, field: 'ledgerEntries' },
    ]);
  });

  it('reads every voucher from the books’ first day, not only Tally’s current period', async () => {
    const earlier = tally.addVoucher(COMPANY, { type: 'Sales', date: '20240715' });
    const current = tally.addVoucher(COMPANY, { type: 'Receipt', date: '20261015' });
    const r = reader();
    const status = await r.companyStatus(COMPANY);
    const page = await r.readPage(COMPANY, status, 0, 2, '2026-11-27');
    expect(page.vouchers.map((v) => v.guid)).toEqual([earlier.guid, current.guid]);
    const asked = tally.requests.find((q) => q.collection === 'BOSVouchers');
    expect(asked?.from).toBe('20240401');
    const snapshot = await r.snapshot(COMPANY, '2026-11-27');
    expect(snapshot.guids).toEqual([earlier.guid, current.guid].sort());
    expect(snapshot.fromDate).toBe('2024-07-15');
  });

  it('never reads a company whose status gives no first day of its books', async () => {
    tally.addCompany('No Books Ltd', { booksFrom: null });
    tally.addVoucher('No Books Ltd', { type: 'Sales' });
    const r = reader();
    const status = await r.companyStatus('No Books Ltd');
    expect(status.booksFrom).toBeUndefined();
    await expect(r.readPage('No Books Ltd', status, 0, 1, '2026-11-27')).rejects.toEqual(
      new TallyUnavailable('no_books_from'),
    );
    await expect(r.snapshot('No Books Ltd', '2026-11-27')).rejects.toEqual(
      new TallyUnavailable('no_books_from'),
    );
    expect(tally.requests.map((q) => q.collection)).toEqual([
      'BOSCompanyStatus',
      'BOSCompanyStatus',
    ]);
  });

  it('reads the snapshot in windows, and on to the new last AlterID when a voucher is edited meanwhile', async () => {
    for (let i = 0; i < 15; i += 1)
      tally.addVoucher(COMPANY, { type: i === 3 ? 'Journal' : 'Sales' });
    const vouchers = tally.vouchersOf(COMPANY);
    const r = reader({ snapshotPageSize: 7 });
    // The first window's answer is on its way when Accounts edits voucher 2 (AlterID 2 -> 16).
    let edited = false;
    const original = tally.requests.push.bind(tally.requests);
    tally.requests.push = (...items) => {
      const count = original(...items);
      if (!edited && items[0]?.collection === 'BOSVoucherGuids') {
        edited = true;
        const second = vouchers[1];
        if (second !== undefined) tally.alterVoucher(COMPANY, second.guid);
      }
      return count;
    };
    const snapshot = await r.snapshot(COMPANY, '2026-11-27');
    expect(snapshot.guids).toHaveLength(14);
    expect(snapshot.guids).toContain(vouchers[1]?.guid);
    expect(snapshot.guids).not.toContain(vouchers[3]?.guid);
    expect(snapshot.fromDate).toBe('2026-09-27');
    const windows = tally.requests
      .filter((q) => q.collection === 'BOSVoucherGuids')
      .map((q) => [q.after, q.upTo]);
    expect(windows).toEqual([
      [0, 7],
      [7, 14],
      [14, 15],
      [15, 16],
    ]);
  });
});

describe('the party ledger balances with the snapshot', () => {
  it('reads every Sundry Debtors balance as at the day, a balance moved without an AlterID too', async () => {
    tally.addVoucher(COMPANY, { type: 'Sales' });
    const dealer = tally.addLedger(COMPANY, { name: 'Kisan Agro Traders', closing: -1000 });
    for (let i = 0; i < 9; i += 1) tally.addVoucher(COMPANY, { type: 'Receipt' });
    const other = tally.addLedger(COMPANY, { gstin: '08AAAAA0000A1Z5' });
    // A sale posts to the first dealer after its master was last altered.
    tally.setClosing(COMPANY, dealer.guid, -26000);
    const r = reader({ snapshotPageSize: 4 });
    const snapshot = await r.snapshot(COMPANY, '2026-11-27');
    expect(snapshot.ledgerBalances).toEqual(
      [
        {
          guid: dealer.guid,
          name: 'Kisan Agro Traders',
          closingBalance: '-26000.00',
          asOf: '2026-11-27',
        },
        { guid: other.guid, name: other.name, closingBalance: '-5012.00', asOf: '2026-11-27' },
      ].sort((a, b) => (a.guid < b.guid ? -1 : 1)),
    );
    const ledgerReads = tally.requests.filter((q) => q.collection === 'BOSLedgers');
    expect(ledgerReads.map((q) => [q.after, q.upTo, q.to])).toEqual([
      [0, 4, '20261127'],
      [4, 8, '20261127'],
      [8, 12, '20261127'],
    ]);
  });
});

describe('throttling', () => {
  it('sends one request at a time, with the pause between, whatever the callers do', async () => {
    tally.addCompany('Shakti Motor Pumps');
    for (let i = 0; i < 3; i += 1) {
      tally.addVoucher(COMPANY, { type: 'Sales' });
      tally.addVoucher('Shakti Motor Pumps', { type: 'Receipt' });
    }
    tally.knobs.delayMs = 20;
    const r = reader({ tallyPauseMs: 60 });
    const [a, b] = await Promise.all([
      r.companyStatus(COMPANY),
      r.companyStatus('Shakti Motor Pumps'),
    ]);
    await Promise.all([
      r.readPage(COMPANY, a, 0, 3, '2026-11-27'),
      r.readPage('Shakti Motor Pumps', b, 0, 3, '2026-11-27'),
      r.snapshot(COMPANY, '2026-11-27'),
    ]);
    expect(tally.maxInFlight).toBe(1);
    const times = tally.requests.map((q) => [q.startedAt, q.endedAt ?? 0]);
    for (let i = 1; i < times.length; i += 1) {
      const gap = (times[i]?.[0] ?? 0) - (times[i - 1]?.[1] ?? 0);
      // Timers are coarser on Windows: well under the pause, well over nothing.
      expect(gap).toBeGreaterThanOrEqual(40);
    }
  });
});

describe('timeouts and retries', () => {
  it('gives up a request Tally does not answer and retries after a doubling wait', async () => {
    tally.knobs.hangNext = 1;
    tally.knobs.failNext = 1;
    tally.addVoucher(COMPANY, { type: 'Sales' });
    const sleeps: number[] = [];
    const r = reader({ tallyTimeoutMs: 150, tallyRetries: 2, tallyBackoffMs: 10 }, sleeps);
    await expect(r.companyStatus(COMPANY)).resolves.toMatchObject({ lastAlterId: 1 });
    expect(sleeps).toEqual([10, 20]);
    expect(tally.requests).toHaveLength(3);
  });

  it('answers unavailable once the retries are spent, and does not retry a closed company', async () => {
    tally.knobs.failNext = 5;
    const r = reader({ tallyRetries: 1 });
    await expect(r.companyStatus(COMPANY)).rejects.toEqual(new TallyUnavailable('unreachable'));
    expect(tally.requests).toHaveLength(2);

    tally.knobs.failNext = 0;
    tally.setOpen(COMPANY, false);
    await expect(r.companyStatus(COMPANY)).rejects.toMatchObject({ reason: 'company_not_open' });
    await expect(r.companyStatus('A company Tally does not have')).rejects.toMatchObject({
      reason: 'tally_error',
    });
    expect(tally.requests).toHaveLength(4);
  });

  it('reads a Tally that answers in UTF-16', async () => {
    tally.knobs.utf16 = true;
    tally.addVoucher(COMPANY, { type: 'Sales' });
    const r = reader();
    const status = await r.companyStatus(COMPANY);
    const page = await r.readPage(COMPANY, status, 0, 1, '2026-11-27');
    expect(page.vouchers[0]?.partyName).toBe('Party 1 & Sons');
  });
});
