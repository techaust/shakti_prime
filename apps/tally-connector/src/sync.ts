import {
  CONNECTOR_CLOCK_SKEW_SECONDS,
  ConnectorBatchRequest,
  ConnectorSnapshotRequest,
  type ConnectorHeartbeatRequest,
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
 * BOS answers: a page of `pageSize` AlterIDs is read, written to the outbox, sent, and marked sent
 * on the BOS's answer, until the company's last AlterID. Once a day after 02:00 India time it sends
 * each company's GUID snapshot the same way.
 */

export type SyncSettings = Pick<Settings, 'pageSize' | 'outboxKeepDays' | 'snapshotAtIst'>;

/** How a company's read or a cycle ended. */
export type Outcome =
  | 'caught_up'
  | 'stopped'
  | 'bos_unavailable'
  | 'tally_unavailable'
  | 'refused'
  | 'superseded';

type Sent = 'sent' | 'bos_unavailable' | 'refused' | 'superseded';

interface CompanyState {
  /** The BOS's cursor, as last answered. */
  lastAlterId: number;
  reachable: boolean;
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

export class Syncer {
  private readonly state = new Map<string, CompanyState>();
  private readonly now: () => Date;
  private tallyVersion = 'unknown';
  private stopping = false;

  constructor(private readonly options: SyncerOptions) {
    this.now = options.now ?? (() => new Date());
    for (const company of options.companies) {
      this.state.set(company.name, { lastAlterId: 0, reachable: false });
    }
  }

  /** Ends the current cycle after the page in hand. */
  requestStop(): void {
    this.stopping = true;
  }

  private entity(company: string): ReturnType<typeof logId> {
    return logId(this.options.companies.find((c) => c.name === company)?.entityCode ?? 'unknown');
  }

  private companyState(company: string): CompanyState {
    let state = this.state.get(company);
    if (state === undefined) {
      state = { lastAlterId: 0, reachable: false };
      this.state.set(company, state);
    }
    return state;
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
      if (error instanceof BosUnavailable) return 'bos_unavailable';
      if (!(error instanceof BosRefused)) throw error;
      log.error('bos_refused', {
        entity: this.entity(row.company),
        outbox: row.id,
        status: error.status,
        code: logId(error.code),
        reason: error.reason === undefined ? null : logId(error.reason),
      });
      // The BOS's cursor is elsewhere (an answer lost longer than the BOS keeps its keys, or a
      // person reset it): the company's queued batches are set aside and Tally is read again from
      // the BOS's cursor, which gives the latest version of every voucher.
      if (row.kind === 'batch' && error.reason === 'cursor_mismatch') {
        const count = this.options.outbox.supersedeBatches(row.company);
        log.warn('batches_superseded', { entity: this.entity(row.company), count });
        return 'superseded';
      }
      return 'refused';
    }
  }

  /**
   * Sends every pending row, oldest first. A company whose row the BOS refuses waits for a person
   * (the row stays pending and is tried again next cycle); the others go on. Stops at the first
   * row the BOS does not answer.
   */
  async drain(): Promise<{ outcome: 'drained' | 'bos_unavailable'; held: Set<string> }> {
    const held = new Set<string>();
    // Batches set aside in this pass: the company is read again from the BOS's cursor.
    const setAside = new Set<string>();
    for (const row of this.options.outbox.pending()) {
      if (row.kind === 'batch' && (held.has(row.company) || setAside.has(row.company))) continue;
      const sent = await this.send(row);
      if (sent === 'bos_unavailable') return { outcome: 'bos_unavailable', held };
      if (row.kind !== 'batch') continue;
      if (sent === 'refused') held.add(row.company);
      if (sent === 'superseded') setAside.add(row.company);
    }
    return { outcome: 'drained', held };
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
      if (error instanceof BosUnavailable) return 'bos_unavailable';
      if (error instanceof BosRefused) {
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
      state.reachable = false;
      log.warn('tally_unavailable', { entity, reason: logId(error.reason) });
      return 'tally_unavailable';
    }
    state.reachable = true;
    if (status.tallyVersion !== undefined) this.tallyVersion = status.tallyVersion;
    if (status.lastAlterId < cursor) {
      // Tally's counter is below what the BOS accepted: a restored backup or a copied data
      // folder. The BOS refuses such batches; a person looks (docs/04-architecture-appendix/tally.md).
      log.error('tally_behind_bos', { entity, tally: status.lastAlterId, bos: cursor });
      return 'refused';
    }

    const asOf = istClock(this.now()).date;
    while (cursor < status.lastAlterId) {
      if (this.stopping) return 'stopped';
      const upTo = Math.min(cursor + settings.pageSize, status.lastAlterId);
      let page;
      try {
        page = await reader.readPage(company.name, status, cursor, upTo, asOf);
      } catch (error) {
        if (!(error instanceof TallyUnavailable)) throw error;
        state.reachable = false;
        log.warn('tally_unavailable', { entity, reason: logId(error.reason) });
        return 'tally_unavailable';
      }
      const batch = {
        company: company.name,
        entityCode: company.entityCode,
        fromAlterId: cursor,
        maxAlterId: upTo,
        vouchers: page.vouchers,
        ledgers: page.ledgers,
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
        skipped: page.skipped,
      });
      const sent = await this.send(row);
      if (sent !== 'sent') return sent;
      if (state.lastAlterId <= cursor) {
        // The BOS did not move its cursor past the page: wait for the next cycle, never loop.
        log.error('cursor_not_moved', { entity, from: cursor, to: upTo });
        return 'refused';
      }
      cursor = state.lastAlterId;
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
   * Reads every voucher GUID the company holds and sends them. `asOf` is when the read began, less
   * the clock difference the BOS accepts, so a voucher the BOS stored while the read ran is never
   * judged against a snapshot that could not hold it.
   */
  async snapshotCompany(company: CompanyMapping): Promise<Outcome> {
    const { reader, outbox, log } = this.options;
    const startedAt = this.now();
    const entity = this.entity(company.name);
    let snapshot;
    try {
      snapshot = await reader.snapshot(company.name);
    } catch (error) {
      if (!(error instanceof TallyUnavailable)) throw error;
      this.companyState(company.name).reachable = false;
      log.warn('tally_unavailable', { entity, reason: logId(error.reason) });
      return 'tally_unavailable';
    }
    const asOf = new Date(startedAt.getTime() - CONNECTOR_CLOCK_SKEW_SECONDS * 1000);
    const body = {
      company: company.name,
      entityCode: company.entityCode,
      asOf: asOf.toISOString(),
      fromDate: snapshot.fromDate ?? istClock(startedAt).date,
      voucherGuids: snapshot.guids,
    };
    if (!ConnectorSnapshotRequest.safeParse(body).success) {
      log.error('snapshot_unreadable', { entity, guids: snapshot.guids.length });
      return 'refused';
    }
    const row = outbox.enqueue({ kind: 'snapshot', company: company.name, body: JSON.stringify(body) });
    outbox.setState(`${SNAPSHOT_STATE}${company.name}`, istClock(startedAt).date);
    log.info('snapshot_read', { entity, outbox: row.id, guids: snapshot.guids.length });
    const sent = await this.send(row);
    return sent === 'sent' ? 'caught_up' : sent;
  }

  /** One cycle: the outbox, each company's read, the snapshots when due, then the clean-up. */
  async cycle(): Promise<Outcome> {
    this.stopping = false;
    const { companies, outbox, settings, log } = this.options;
    const drained = await this.drain();
    if (drained.outcome === 'bos_unavailable') return 'bos_unavailable';
    for (const company of companies) {
      if (drained.held.has(company.name)) continue;
      const outcome = await this.readCompany(company);
      if (outcome === 'bos_unavailable' || outcome === 'stopped') return outcome;
    }
    for (const company of companies) {
      if (this.stopping) return 'stopped';
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
        return { name: company.name, lastAlterId: state.lastAlterId, reachable: state.reachable };
      }),
      queueDepth: this.options.outbox.depth(),
    };
  }

  /** Sends the heartbeat from what the last cycle learnt; it never asks Tally anything. */
  async heartbeat(): Promise<boolean> {
    const request = this.heartbeatRequest();
    try {
      const answer = await this.options.client.heartbeat(request);
      this.options.log.info('heartbeat', {
        queue: request.queueDepth,
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
