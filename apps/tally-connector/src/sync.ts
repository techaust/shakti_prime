import {
  CONNECTOR_BATCH_MAX_LEDGERS,
  CONNECTOR_BATCH_MAX_VOUCHERS,
  CONNECTOR_CLOCK_SKEW_SECONDS,
  ConnectorBatchRequest,
  ConnectorSnapshotRequest,
  type ConnectorHeartbeatRequest,
  type TallyCompanyProblem,
} from '@shakti/contracts';
import { BosRefused, BosUnavailable, type BosClient } from './client';
import type { CompanyMapping } from './config';
import { errorKind, logId, type Log } from './log';
import type { Outbox, OutboxRow } from './outbox';
import { CONNECTOR_VERSION, istClock, type Settings } from './settings';
import { TallyUnavailable, type TallyReader } from './tally/reader';

/**
 * One installation's sync (ADR 0013, docs/03-roadmap-appendix/phase5.md §6.2). A cycle first sends
 * what the outbox still holds, oldest first, then reads each company in turn from the cursor the
 * BOS answers: a window of AlterIDs is read, written to the outbox, sent, and marked sent on the
 * BOS's answer, until the company's last AlterID. The window starts at `pageSize`, doubles after a
 * sparse page and halves after a dense one. Once a day after 02:00 India time it sends each
 * company's GUID snapshot the same way.
 *
 * A row the BOS refuses, or answers with what the connector cannot read, stays pending and holds
 * the company's later batches (they must arrive in order) but nothing else; after
 * `outboxMaxAttempts` such answers it is set aside, logged and counted in the heartbeat.
 */

export type SyncSettings = Pick<
  Settings,
  | 'pageSize'
  | 'pageSizeMax'
  | 'pageGrowBelowRows'
  | 'pageShrinkAboveRows'
  | 'outboxKeepDays'
  | 'outboxMaxAttempts'
  | 'snapshotAtIst'
>;

/** How a company's read or a cycle ended. */
export type Outcome =
  'caught_up' | 'stopped' | 'bos_unavailable' | 'tally_unavailable' | 'refused' | 'superseded';

/**
 * How one send ended: `refused` when the BOS answered without taking the row (it stays pending),
 * `held` when that was its last allowed attempt (it is set aside).
 */
type Sent = 'sent' | 'bos_unavailable' | 'refused' | 'held' | 'superseded';

interface CompanyState {
  /** The BOS's cursor, as last answered. */
  lastAlterId: number;
  reachable: boolean;
  /** Tally's last AlterID, as read in the last cycle. */
  tallyLastAlterId: number | undefined;
  problem: TallyCompanyProblem | undefined;
  /** The AlterIDs the next page reads. */
  window: number;
}

export interface SyncerOptions {
  companies: readonly CompanyMapping[];
  reader: TallyReader;
  client: BosClient;
  outbox: Outbox;
  log: Log;
  settings: SyncSettings;
  now?: () => Date;
}

const SNAPSHOT_STATE = 'snapshot_day:';

/** The BOS answered, but not with what the connector can use: the call is not worth repeating now. */
function answeredBadly(error: unknown): boolean {
  return error instanceof BosUnavailable && error.reason === 'bad_answer';
}

export class Syncer {
  private readonly state = new Map<string, CompanyState>();
  private readonly now: () => Date;
  private tallyVersion = 'unknown';
  private stopping = false;

  constructor(private readonly options: SyncerOptions) {
    this.now = options.now ?? (() => new Date());
    for (const company of options.companies) this.companyState(company.name);
  }

  /** Ends the current cycle after the page in hand. */
  requestStop(): void {
    this.stopping = true;
  }

  /** Read through a method: `requestStop()` changes it while a cycle is awaited. */
  private stopRequested(): boolean {
    return this.stopping;
  }

  private entity(company: string): ReturnType<typeof logId> {
    return logId(this.options.companies.find((c) => c.name === company)?.entityCode ?? 'unknown');
  }

  private companyState(company: string): CompanyState {
    let state = this.state.get(company);
    if (state === undefined) {
      state = {
        lastAlterId: 0,
        reachable: false,
        tallyLastAlterId: undefined,
        problem: undefined,
        window: this.options.settings.pageSize,
      };
      this.state.set(company, state);
    }
    return state;
  }

  /** Tally failed the company: unreachable, or without a first day of its books. */
  private tallyFailed(company: string, error: TallyUnavailable): Outcome {
    const state = this.companyState(company);
    const entity = this.entity(company);
    if (error.reason === 'no_books_from') {
      // Tally answers, but reading without a period would pass over earlier years' vouchers.
      state.reachable = true;
      state.problem = 'no_books_from';
      this.options.log.error('company_without_books_from', { entity });
      return 'refused';
    }
    state.reachable = false;
    this.options.log.warn('tally_unavailable', { entity, reason: logId(error.reason) });
    return 'tally_unavailable';
  }

  /** Sends one outbox row under its own key; the row is marked sent only on the BOS's answer. */
  private async send(row: OutboxRow): Promise<Sent> {
    const { client, outbox, log } = this.options;
    outbox.noteAttempt(row.id);
    try {
      if (row.kind === 'batch') {
        const answer = await client.sendBatch(row);
        outbox.markSent(row.id);
        this.companyState(row.company).lastAlterId = answer.lastAlterId;
        log.info('batch_sent', {
          entity: this.entity(row.company),
          outbox: row.id,
          from: row.fromAlterId,
          to: answer.lastAlterId,
          new: answer.accepted.vouchersNew,
          changed: answer.accepted.vouchersChanged,
          unchanged: answer.accepted.vouchersUnchanged,
          ledgers: answer.accepted.ledgers,
        });
      } else {
        const answer = await client.sendSnapshot(row);
        outbox.markSent(row.id);
        log.info('snapshot_sent', {
          entity: this.entity(row.company),
          outbox: row.id,
          known: answer.known,
          tombstoned: answer.tombstoned,
          missing: answer.missingOnServer.length,
        });
      }
      return 'sent';
    } catch (error) {
      if (error instanceof BosUnavailable && !answeredBadly(error)) return 'bos_unavailable';
      if (!(error instanceof BosRefused) && !answeredBadly(error)) throw error;
      const code = error instanceof BosRefused ? error.code : 'bad_answer';
      const reason = error instanceof BosRefused ? error.reason : undefined;
      log.error(error instanceof BosRefused ? 'bos_refused' : 'bos_answer_unreadable', {
        entity: this.entity(row.company),
        outbox: row.id,
        status: error instanceof BosRefused ? error.status : null,
        code: logId(code),
        reason: reason === undefined ? null : logId(reason),
      });
      // The BOS's cursor is elsewhere (an answer lost longer than the BOS keeps its keys, or a
      // person reset it): the company's queued batches are set aside and Tally is read again from
      // the BOS's cursor, which gives the latest version of every voucher.
      if (row.kind === 'batch' && reason === 'cursor_mismatch') {
        const count = outbox.supersedeBatches(row.company);
        log.warn('batches_superseded', { entity: this.entity(row.company), count });
        return 'superseded';
      }
      if (row.kind === 'batch') this.companyState(row.company).problem = 'waiting_on_bos';
      if (outbox.noteRefusal(row.id) < this.options.settings.outboxMaxAttempts) return 'refused';
      outbox.hold(row.id);
      log.error('outbox_row_held', {
        entity: this.entity(row.company),
        outbox: row.id,
        kind: logId(row.kind),
        key: logId(row.idempotencyKey),
        code: logId(reason ?? code),
      });
      return 'held';
    }
  }

  /**
   * Sends every pending row, oldest first. A batch the BOS does not take holds the company's later
   * batches, which must arrive in order; snapshots and the other companies go on. Stops only when
   * the BOS does not answer at all.
   */
  async drain(): Promise<'drained' | 'bos_unavailable'> {
    // Companies whose batches wait behind one the BOS did not take, or were set aside, this pass.
    const waiting = new Set<string>();
    const companies = new Map(this.options.companies.map((c) => [c.name, c]));
    for (const row of this.options.outbox.pending()) {
      if (row.kind === 'batch' && waiting.has(row.company)) continue;
      // A day's snapshot still waiting when the next is due is replaced later in this cycle.
      const company = companies.get(row.company);
      if (row.kind === 'snapshot' && company !== undefined && this.snapshotDue(company)) continue;
      const sent = await this.send(row);
      if (sent === 'bos_unavailable') return 'bos_unavailable';
      // A batch set aside after its last attempt does not hold the next one: the BOS either
      // applied it (an answer the connector could not read) or answers the next `cursor_mismatch`,
      // which sets them all aside and reads again from its cursor.
      if (row.kind === 'batch' && (sent === 'refused' || sent === 'superseded')) {
        waiting.add(row.company);
      }
    }
    return 'drained';
  }

  /**
   * Asks Tally for a company's state only, for a company whose batches wait: the heartbeat's lag
   * stays current while nothing is read.
   */
  private async refreshTally(company: CompanyMapping): Promise<void> {
    const state = this.companyState(company.name);
    try {
      const status = await this.options.reader.companyStatus(company.name);
      state.reachable = true;
      state.tallyLastAlterId = status.lastAlterId;
      if (status.tallyVersion !== undefined) this.tallyVersion = status.tallyVersion;
    } catch (error) {
      if (!(error instanceof TallyUnavailable)) throw error;
      this.tallyFailed(company.name, error);
    }
  }

  /** The next window after a page of `rows`: wider after a sparse page, narrower after a dense one. */
  private nextWindow(window: number, rows: number): number {
    const { pageSize, pageSizeMax, pageGrowBelowRows, pageShrinkAboveRows } = this.options.settings;
    if (rows < pageGrowBelowRows) return Math.min(window * 2, pageSizeMax);
    if (rows > pageShrinkAboveRows) return Math.max(Math.floor(window / 2), pageSize);
    return window;
  }

  /** Reads a company from the BOS's cursor to Tally's last AlterID, a page at a time. */
  async readCompany(company: CompanyMapping): Promise<Outcome> {
    const { client, reader, outbox, log, settings } = this.options;
    const state = this.companyState(company.name);
    const entity = this.entity(company.name);
    let cursor: number;
    try {
      cursor = (await client.cursor(company.name)).lastAlterId;
    } catch (error) {
      if (answeredBadly(error)) {
        state.problem = 'waiting_on_bos';
        return 'refused';
      }
      if (error instanceof BosUnavailable) return 'bos_unavailable';
      if (error instanceof BosRefused) {
        state.problem = 'waiting_on_bos';
        log.error('bos_refused', { entity, status: error.status, code: logId(error.code) });
        return 'refused';
      }
      throw error;
    }
    state.lastAlterId = cursor;

    let status;
    try {
      status = await reader.companyStatus(company.name);
    } catch (error) {
      if (!(error instanceof TallyUnavailable)) throw error;
      return this.tallyFailed(company.name, error);
    }
    state.reachable = true;
    state.tallyLastAlterId = status.lastAlterId;
    if (status.tallyVersion !== undefined) this.tallyVersion = status.tallyVersion;
    if (status.booksFrom === undefined) {
      return this.tallyFailed(company.name, new TallyUnavailable('no_books_from'));
    }
    if (status.lastAlterId < cursor) {
      // Tally's counter is below what the BOS accepted: a restored backup or a copied data
      // folder. The BOS refuses such batches; a person looks (docs/04-architecture-appendix/tally.md).
      state.problem = 'tally_behind_bos';
      log.error('tally_behind_bos', { entity, tally: status.lastAlterId, bos: cursor });
      return 'refused';
    }
    state.problem = undefined;

    const asOf = istClock(this.now()).date;
    while (cursor < status.lastAlterId) {
      if (this.stopRequested()) return 'stopped';
      const upTo = Math.min(cursor + state.window, status.lastAlterId);
      let page;
      try {
        page = await reader.readPage(company.name, status, cursor, upTo, asOf);
      } catch (error) {
        if (!(error instanceof TallyUnavailable)) throw error;
        return this.tallyFailed(company.name, error);
      }
      const tooMany =
        page.vouchers.length > CONNECTOR_BATCH_MAX_VOUCHERS ||
        page.ledgers.length > CONNECTOR_BATCH_MAX_LEDGERS;
      if (tooMany && state.window > settings.pageSize) {
        // More rows than one batch carries: the same stretch is read again in a narrower window.
        state.window = Math.max(Math.floor(state.window / 2), settings.pageSize);
        log.info('page_narrowed', { entity, from: cursor, window: state.window });
        continue;
      }
      const batch = {
        company: company.name,
        entityCode: company.entityCode,
        fromAlterId: cursor,
        maxAlterId: upTo,
        vouchers: page.vouchers,
        ledgers: page.ledgers,
        ...(page.refused.length === 0 ? {} : { refused: page.refused }),
      };
      if (!ConnectorBatchRequest.safeParse(batch).success) {
        log.error('batch_unreadable', { entity, from: cursor, to: upTo });
        return 'refused';
      }
      const row = outbox.enqueue({
        kind: 'batch',
        company: company.name,
        fromAlterId: cursor,
        maxAlterId: upTo,
        body: JSON.stringify(batch),
      });
      log.info('page_read', {
        entity,
        outbox: row.id,
        from: cursor,
        to: upTo,
        vouchers: page.vouchers.length,
        ledgers: page.ledgers.length,
        refused: page.refused.length,
        skipped: page.skipped,
        scanned: page.scanned,
      });
      const sent = await this.send(row);
      if (sent === 'held') return 'refused';
      if (sent !== 'sent') return sent;
      if (state.lastAlterId <= cursor) {
        // The BOS did not move its cursor past the page: wait for the next cycle, never loop.
        log.error('cursor_not_moved', { entity, from: cursor, to: upTo });
        return 'refused';
      }
      cursor = state.lastAlterId;
      state.window = this.nextWindow(state.window, page.scanned);
    }
    return 'caught_up';
  }

  /** True after the snapshot hour on an India day the company has no snapshot for yet. */
  snapshotDue(company: CompanyMapping): boolean {
    const { date, minutes } = istClock(this.now());
    const { hour, minute } = this.options.settings.snapshotAtIst;
    return (
      minutes >= hour * 60 + minute &&
      this.options.outbox.getState(`${SNAPSHOT_STATE}${company.name}`) !== date
    );
  }

  /**
   * Reads every voucher GUID the company holds, with every party ledger's closing balance for the
   * day (dealer outstanding), and sends them. `asOf` is when the read began, less
   * the clock difference the BOS accepts, so a voucher the BOS stored while the read ran is never
   * judged against a snapshot that could not hold it. An older snapshot still pending is replaced.
   */
  async snapshotCompany(company: CompanyMapping): Promise<Outcome> {
    const { reader, outbox, log } = this.options;
    const startedAt = this.now();
    const entity = this.entity(company.name);
    let snapshot;
    try {
      snapshot = await reader.snapshot(company.name, istClock(startedAt).date);
    } catch (error) {
      if (!(error instanceof TallyUnavailable)) throw error;
      return this.tallyFailed(company.name, error);
    }
    const asOf = new Date(startedAt.getTime() - CONNECTOR_CLOCK_SKEW_SECONDS * 1000);
    const body = {
      company: company.name,
      entityCode: company.entityCode,
      asOf: asOf.toISOString(),
      fromDate: snapshot.fromDate ?? istClock(startedAt).date,
      voucherGuids: snapshot.guids,
      ledgerBalances: snapshot.ledgerBalances,
    };
    if (!ConnectorSnapshotRequest.safeParse(body).success) {
      log.error('snapshot_unreadable', { entity, guids: snapshot.guids.length });
      return 'refused';
    }
    const row = outbox.enqueue({
      kind: 'snapshot',
      company: company.name,
      body: JSON.stringify(body),
    });
    outbox.setState(`${SNAPSHOT_STATE}${company.name}`, istClock(startedAt).date);
    const replaced = outbox.supersedeSnapshots(company.name, row.id);
    log.info('snapshot_read', {
      entity,
      outbox: row.id,
      guids: snapshot.guids.length,
      ledgers: snapshot.ledgerBalances.length,
      replaced,
    });
    const sent = await this.send(row);
    if (sent === 'sent') return 'caught_up';
    return sent === 'held' ? 'refused' : sent;
  }

  /** One cycle: the outbox, each company's read, the snapshots when due, then the clean-up. */
  async cycle(): Promise<Outcome> {
    this.stopping = false;
    const { companies, outbox, settings, log } = this.options;
    if ((await this.drain()) === 'bos_unavailable') return 'bos_unavailable';
    for (const company of companies) {
      if (this.stopRequested()) return 'stopped';
      if (outbox.hasPendingBatches(company.name)) {
        // Its next page must wait for the batch ahead of it; Tally's figure stays current.
        this.companyState(company.name).problem = 'waiting_on_bos';
        await this.refreshTally(company);
        continue;
      }
      const outcome = await this.readCompany(company);
      if (outcome === 'bos_unavailable' || outcome === 'stopped') return outcome;
    }
    for (const company of companies) {
      if (this.stopRequested()) return 'stopped';
      if (!this.snapshotDue(company)) continue;
      const outcome = await this.snapshotCompany(company);
      if (outcome === 'bos_unavailable') return outcome;
    }
    const removed = outbox.prune(settings.outboxKeepDays);
    if (removed > 0) log.info('outbox_pruned', { removed });
    return 'caught_up';
  }

  heartbeatRequest(): ConnectorHeartbeatRequest {
    return {
      connectorVersion: CONNECTOR_VERSION,
      tallyVersion: this.tallyVersion,
      companies: this.options.companies.map((company) => {
        const state = this.companyState(company.name);
        return {
          name: company.name,
          lastAlterId: state.lastAlterId,
          reachable: state.reachable,
          ...(state.tallyLastAlterId === undefined
            ? {}
            : { tallyLastAlterId: state.tallyLastAlterId }),
          ...(state.problem === undefined ? {} : { problem: state.problem }),
        };
      }),
      queueDepth: this.options.outbox.depth(),
      heldRows: this.options.outbox.heldCount(),
    };
  }

  /** Sends the heartbeat from what the last cycle learnt; it never asks Tally anything. */
  async heartbeat(): Promise<boolean> {
    const request = this.heartbeatRequest();
    try {
      const answer = await this.options.client.heartbeat(request);
      this.options.log.info('heartbeat', {
        queue: request.queueDepth,
        held: request.heldRows ?? 0,
        reachable: request.companies.filter((c) => c.reachable).length,
        updateAvailable: answer.updateAvailable,
      });
      return true;
    } catch (error) {
      this.options.log.warn('heartbeat_failed', { kind: errorKind(error) });
      return false;
    }
  }
}
