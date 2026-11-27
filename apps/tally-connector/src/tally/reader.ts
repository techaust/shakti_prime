import { TallyLedger, TallyVoucher } from '@shakti/contracts';
import { errorKind, logId, type Log } from '../log';
import type { Settings } from '../settings';
import {
  companyStatusRequest,
  decodeTallyAnswer,
  ledgersPageRequest,
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
  'pageSize' | 'snapshotPageSize' | 'tallyPauseMs' | 'tallyTimeoutMs' | 'tallyRetries' | 'tallyBackoffMs'
>;

/** Tally did not answer, answered an error, or does not have the company open. */
export class TallyUnavailable extends Error {
  override name = 'TallyUnavailable';
  constructor(readonly reason: 'unreachable' | 'company_not_open' | 'tally_error') {
    super(reason);
  }
}

export interface Page {
  vouchers: TallyVoucher[];
  ledgers: TallyLedger[];
  /** Rows Tally gave that the contract cannot carry, by GUID; logged and left out. */
  skipped: number;
}

export interface Snapshot {
  guids: string[];
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

  private period(status: CompanyStatus): TallyPeriod | undefined {
    return status.booksFrom === undefined
      ? undefined
      : { from: status.booksFrom, to: periodTo(this.now()) };
  }

  /**
   * Vouchers and party ledgers with an AlterID in `(after, upTo]`, each checked against the
   * contract. A row the contract refuses is left out and logged by GUID, so one odd voucher cannot
   * hold up every later one; a GUID twice keeps its highest AlterID.
   */
  async readPage(
    company: string,
    status: CompanyStatus,
    after: number,
    upTo: number,
    asOf: string,
  ): Promise<Page> {
    const voucherXml = await this.ask(
      vouchersPageRequest(company, after, upTo, this.period(status)),
    );
    const ledgerXml = await this.ask(ledgersPageRequest(company, after, upTo));
    let skipped = 0;
    const inRange = (row: Record<string, unknown>) =>
      typeof row.alterId === 'number' && row.alterId > after && row.alterId <= upTo;

    const vouchers = new Map<string, TallyVoucher>();
    for (const row of parseVoucherExport(voucherXml).filter(inRange)) {
      const parsed = TallyVoucher.safeParse(row);
      if (!parsed.success) {
        skipped += 1;
        this.options.log.warn('voucher_unreadable', {
          guid: logId(String(row.guid)),
          field: logId(String(parsed.error.issues[0]?.path[0] ?? 'unknown')),
        });
        continue;
      }
      const seen = vouchers.get(parsed.data.guid);
      if (seen === undefined || parsed.data.alterId > seen.alterId) {
        vouchers.set(parsed.data.guid, parsed.data);
      }
    }
    const ledgers = new Map<string, TallyLedger>();
    for (const row of parseLedgerExport(ledgerXml, asOf).filter(inRange)) {
      const parsed = TallyLedger.safeParse(row);
      if (!parsed.success) {
        skipped += 1;
        this.options.log.warn('ledger_unreadable', {
          guid: logId(String(row.guid)),
          field: logId(String(parsed.error.issues[0]?.path[0] ?? 'unknown')),
        });
        continue;
      }
      const seen = ledgers.get(parsed.data.guid);
      if (seen === undefined || parsed.data.alterId > seen.alterId) {
        ledgers.set(parsed.data.guid, parsed.data);
      }
    }
    const byAlterId = (a: { alterId: number }, b: { alterId: number }) => a.alterId - b.alterId;
    return {
      vouchers: [...vouchers.values()].sort(byAlterId),
      ledgers: [...ledgers.values()].sort(byAlterId),
      skipped,
    };
  }

  /**
   * Every GUID of a voucher the BOS reads that the company holds, read in AlterID windows of `snapshotPageSize`. A voucher
   * altered while the windows are read moves above the last one, so the read goes on to the
   * company's new last AlterID until it stops moving: no voucher is left out for being edited.
   */
  async snapshot(company: string): Promise<Snapshot> {
    const guids = new Set<string>();
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
        after = upTo;
      }
      const latest = await this.companyStatus(company);
      if (latest.lastAlterId <= status.lastAlterId) break;
      status = latest;
    }
    return { guids: [...guids].sort(), fromDate };
  }
}
