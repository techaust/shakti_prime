import { TallyLedger, TallyLedgerBalance, TallyRefusedRow, TallyVoucher } from '@shakti/contracts';
import { errorKind, logId, type Log } from '../log';
import type { Settings } from '../settings';
import {
  companyStatusRequest,
  decodeTallyAnswer,
  ledgersPageRequest,
  objectCount,
  parseCompanyStatus,
  parseGuidReadings,
  parseLedgerExport,
  parseVoucherExport,
  tallyAnswerProblem,
  voucherGuidsRequest,
  vouchersPageRequest,
  type CompanyStatus,
  type TallyPeriod,
} from './xml';

/**
 * Reads Tally's XML server on `TALLY_URL` (ADR 0013): one request at a time across every company,
 * with `tallyPauseMs` between the end of one and the start of the next, each given up after
 * `tallyTimeoutMs` and retried `tallyRetries` times after a doubling wait. Only exports are sent.
 */

export type ReaderSettings = Pick<
  Settings,
  | 'pageSize'
  | 'snapshotPageSize'
  | 'tallyPauseMs'
  | 'tallyTimeoutMs'
  | 'tallyRetries'
  | 'tallyBackoffMs'
>;

/**
 * Tally did not answer, answered an error, or does not have the company open; or the company gives
 * no usable first day of its books (`no_books_from`), so it cannot be read with a period.
 */
export class TallyUnavailable extends Error {
  override name = 'TallyUnavailable';
  constructor(
    readonly reason: 'unreachable' | 'company_not_open' | 'tally_error' | 'no_books_from',
  ) {
    super(reason);
  }
}

export interface Page {
  vouchers: TallyVoucher[];
  ledgers: TallyLedger[];
  /** Rows Tally gave that the contract cannot carry, by GUID and field: the BOS queues them. */
  refused: TallyRefusedRow[];
  /** Refused rows whose GUID cannot even be reported; logged only. */
  skipped: number;
  /** Every voucher and ledger Tally answered with, read or not: what the page cost Tally. */
  scanned: number;
}

export interface Snapshot {
  guids: string[];
  /** Every party ledger's closing balance as at the snapshot's day, each GUID once. */
  ledgerBalances: TallyLedgerBalance[];
  /** The earliest voucher date in the snapshot, or `undefined` for a company with no vouchers. */
  fromDate: string | undefined;
}

export interface TallyReaderOptions {
  url: string;
  settings: ReaderSettings;
  log: Log;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Today plus a year, as a Tally date: the end of every voucher read, past post-dated vouchers. */
function periodTo(now: number): string {
  const to = new Date(now);
  to.setUTCFullYear(to.getUTCFullYear() + 1, 11, 31);
  return to.toISOString().slice(0, 10).replaceAll('-', '');
}

export class TallyReader {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** Requests queue here, so only one is ever in flight. */
  private line: Promise<unknown> = Promise.resolve();
  private lastAnswerAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: TallyReaderOptions) {
    this.fetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? wait;
    this.now = options.now ?? Date.now;
  }

  /** Sends one export, after the queue ahead of it and the pause; retried on a failure. */
  private ask(xml: string): Promise<string> {
    const turn = this.line.then(() => this.askWithRetries(xml));
    this.line = turn.catch(() => undefined);
    return turn;
  }

  private async askWithRetries(xml: string): Promise<string> {
    const { tallyRetries, tallyBackoffMs } = this.options.settings;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.askOnce(xml);
      } catch (error) {
        if (error instanceof TallyUnavailable && error.reason !== 'unreachable') throw error;
        if (attempt >= tallyRetries) throw new TallyUnavailable('unreachable');
        this.options.log.warn('tally_retry', { attempt: attempt + 1, kind: errorKind(error) });
        await this.sleep(tallyBackoffMs * 2 ** attempt);
      }
    }
  }

  private async askOnce(xml: string): Promise<string> {
    const pause = this.lastAnswerAt + this.options.settings.tallyPauseMs - this.now();
    if (pause > 0) await this.sleep(pause);
    try {
      const response = await this.fetch(this.options.url, {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8' },
        body: xml,
        signal: AbortSignal.timeout(this.options.settings.tallyTimeoutMs),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok) throw new TallyUnavailable('unreachable');
      const text = decodeTallyAnswer(bytes);
      const problem = tallyAnswerProblem(text);
      if (problem !== undefined) {
        this.options.log.warn('tally_refused', { problem: logId(problem) });
        throw new TallyUnavailable('tally_error');
      }
      return text;
    } finally {
      this.lastAnswerAt = this.now();
    }
  }

  /** The company's last AlterID, first day and Tally's version. */
  async companyStatus(company: string): Promise<CompanyStatus> {
    const status = parseCompanyStatus(await this.ask(companyStatusRequest(company)));
    if (status === undefined) throw new TallyUnavailable('company_not_open');
    return status;
  }

  /**
   * The books' first day. Without it Tally would read only the company's current period, and a
   * page would pass over earlier years' vouchers unseen, so the company is not read at all.
   */
  private booksFrom(status: CompanyStatus): string {
    if (status.booksFrom === undefined) throw new TallyUnavailable('no_books_from');
    return status.booksFrom;
  }

  /** From the books' first day to `asOf` (`YYYY-MM-DD`): a ledger's closing balance on that day. */
  private balancePeriod(status: CompanyStatus, asOf: string): TallyPeriod {
    return { from: this.booksFrom(status), to: asOf.replaceAll('-', '') };
  }

  private period(status: CompanyStatus): TallyPeriod {
    return { from: this.booksFrom(status), to: periodTo(this.now()) };
  }

  /** A row the contract refused: reported to the BOS by GUID and field, and logged by the same. */
  private refusal(
    kind: TallyRefusedRow['kind'],
    row: Record<string, unknown>,
    issues: readonly { path: readonly PropertyKey[] }[],
  ): TallyRefusedRow | undefined {
    const field = issues[0]?.path[0];
    const reading = TallyRefusedRow.safeParse({
      kind,
      guid: row.guid,
      alterId: row.alterId,
      field: typeof field === 'string' ? field : 'unknown',
    });
    this.options.log.warn(`${kind}_unreadable`, {
      guid: logId(String(row.guid)),
      field: logId(typeof field === 'string' ? field : 'unknown'),
      reported: reading.success,
    });
    return reading.success ? reading.data : undefined;
  }

  /**
   * Vouchers and party ledgers with an AlterID in `(after, upTo]`, each checked against the
   * contract. A row the contract refuses goes in the page's `refused` list by GUID and field, so
   * one odd voucher cannot hold up every later one and the BOS still learns of it; a GUID twice
   * keeps its highest AlterID.
   */
  async readPage(
    company: string,
    status: CompanyStatus,
    after: number,
    upTo: number,
    asOf: string,
  ): Promise<Page> {
    const period = this.period(status);
    const balancePeriod = this.balancePeriod(status, asOf);
    const voucherXml = await this.ask(vouchersPageRequest(company, after, upTo, period));
    const ledgerXml = await this.ask(ledgersPageRequest(company, after, upTo, balancePeriod));
    const refused: TallyRefusedRow[] = [];
    let skipped = 0;
    const inRange = (row: Record<string, unknown>) =>
      typeof row.alterId === 'number' && row.alterId > after && row.alterId <= upTo;
    const keepLatest = <T extends { guid: string; alterId: number }>(
      rows: Map<string, T>,
      row: T,
    ) => {
      const seen = rows.get(row.guid);
      if (seen === undefined || row.alterId > seen.alterId) rows.set(row.guid, row);
    };

    const vouchers = new Map<string, TallyVoucher>();
    for (const row of parseVoucherExport(voucherXml).filter(inRange)) {
      const parsed = TallyVoucher.safeParse(row);
      if (parsed.success) {
        keepLatest(vouchers, parsed.data);
        continue;
      }
      const refusal = this.refusal('voucher', row, parsed.error.issues);
      if (refusal === undefined) skipped += 1;
      else refused.push(refusal);
    }
    const ledgers = new Map<string, TallyLedger>();
    for (const row of parseLedgerExport(ledgerXml, asOf).filter(inRange)) {
      const parsed = TallyLedger.safeParse(row);
      if (parsed.success) {
        keepLatest(ledgers, parsed.data);
        continue;
      }
      const refusal = this.refusal('ledger', row, parsed.error.issues);
      if (refusal === undefined) skipped += 1;
      else refused.push(refusal);
    }
    const byAlterId = (a: { alterId: number }, b: { alterId: number }) => a.alterId - b.alterId;
    return {
      vouchers: [...vouchers.values()].sort(byAlterId),
      ledgers: [...ledgers.values()].sort(byAlterId),
      refused: refused.sort(byAlterId),
      skipped,
      scanned: objectCount(voucherXml, 'VOUCHER') + objectCount(ledgerXml, 'LEDGER'),
    };
  }

  /**
   * Every GUID of a voucher the BOS reads that the company holds, and every party ledger's closing
   * balance as at `asOf` (`YYYY-MM-DD`), read in AlterID windows of `snapshotPageSize`. A voucher or
   * ledger altered while the windows are read moves above the last one, so the read goes on to the
   * company's new last AlterID until it stops moving: nothing is left out for being edited.
   */
  async snapshot(company: string, asOf: string): Promise<Snapshot> {
    const guids = new Set<string>();
    const balances = new Map<string, { alterId: number; balance: TallyLedgerBalance }>();
    let fromDate: string | undefined;
    let status = await this.companyStatus(company);
    let after = 0;
    for (;;) {
      while (after < status.lastAlterId) {
        const upTo = Math.min(after + this.options.settings.snapshotPageSize, status.lastAlterId);
        const xml = await this.ask(
          voucherGuidsRequest(company, { after, upTo }, this.period(status)),
        );
        // Only the types the BOS reads: a journal it never received is not missing there.
        for (const reading of parseGuidReadings(xml)) {
          if (reading.type === undefined) continue;
          guids.add(reading.guid);
          if (reading.date !== undefined && (fromDate === undefined || reading.date < fromDate)) {
            fromDate = reading.date;
          }
        }
        const ledgerXml = await this.ask(
          ledgersPageRequest(company, after, upTo, this.balancePeriod(status, asOf)),
        );
        for (const row of parseLedgerExport(ledgerXml, asOf)) {
          const parsed = TallyLedgerBalance.safeParse({
            guid: row.guid,
            name: row.name,
            closingBalance: row.closingBalance,
            asOf: row.asOf,
          });
          if (!parsed.success || typeof row.alterId !== 'number') {
            this.options.log.warn('ledger_unreadable', {
              guid: logId(String(row.guid)),
              field: logId(String(parsed.error?.issues[0]?.path[0] ?? 'alterId')),
            });
            continue;
          }
          const seen = balances.get(parsed.data.guid);
          if (seen === undefined || row.alterId > seen.alterId) {
            balances.set(parsed.data.guid, { alterId: row.alterId, balance: parsed.data });
          }
        }
        after = upTo;
      }
      const latest = await this.companyStatus(company);
      if (latest.lastAlterId <= status.lastAlterId) break;
      status = latest;
    }
    return {
      guids: [...guids].sort(),
      ledgerBalances: [...balances.values()]
        .map((b) => b.balance)
        .sort((a, b) => (a.guid < b.guid ? -1 : 1)),
      fromDate,
    };
  }
}
