import {
  companyStanding,
  deleteCallRecording,
  dueCallRecordings,
  executeCommand,
  executeQuery,
  recordProviderCall,
  unendedProviderCalls,
  WORKSHOP_DEFAULTS,
  type FileStore,
  type Logger,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import { systemWorkersPrincipal } from '../events/system-principal';

/**
 * How long a dial may wait for the provider's id or first report before the sweep closes it as
 * failed: Exotel answers a dial within seconds and reports its end within minutes of it, so an hour
 * leaves room for a slow report and keeps a timeline honest the same afternoon.
 */
export const UNPLACED_DIAL_MINUTES = 60;

/**
 * How long a call may stay ringing or on the line before the sweep takes its end as never coming:
 * Exotel ends every call by its time limit (`CALL_TIME_LIMIT_SECONDS`, two and a half hours) and
 * reports it within minutes, so a call still open three hours after the press is one whose end
 * was lost. The call bar stops reading a call after the same time.
 */
export const OPEN_CALL_HOURS = 3;

/** Rows a call reads at a time. */
const PAGE = 200;

export interface CallsSweepDeps {
  /** The environment's store, whose recordings the sweep removes; none where no store exists. */
  store: FileStore | undefined;
  requestId: string;
  logger?: Logger;
  /** Start no new company after this long; the next hour's run carries on. */
  budgetMs?: number;
  now?: () => Date;
}

export interface CallsSweepResult {
  companies: number;
  /** Dials never taken nor reported, recorded as failed. */
  dialsClosed: number;
  /** Recordings past the retention period whose bytes were removed. */
  recordingsRemoved: number;
  /** Calls that failed, each logged by its ids and passed by until the next hour. */
  failures: number;
}

/** The moment `months` calendar months before `at`. */
export function monthsBefore(at: Date, months: number): Date {
  const before = new Date(at.getTime());
  before.setUTCMonth(before.getUTCMonth() - months);
  return before;
}

/**
 * The hourly upkeep of click-to-dial calls (docs/03-roadmap-appendix/phase2.md §6.3), run with the
 * files sweep by the worker principal (`calls.process`), for each company in turn in a request for
 * that company alone:
 * 1. a dial still `dialling` with no provider id an hour after it started (a provider that never
 *    answered the dial nor reported the call), and a call still ringing or on the line three hours
 *    after it started (its end never reported), are recorded as failed
 *    (`calls.provider_call.record`), so no call stays open on a timeline, and a report that comes
 *    later changes nothing back;
 * 2. call recordings older than `WORKSHOP_DEFAULTS.retention.callRecordingMonths` have their bytes
 *    deleted from the store (every version it kept), then are recorded deleted
 *    (`calls.recording.delete`), keeping the call and the file's row; a recording the store refuses
 *    is never recorded deleted while its bytes remain, and waits for the next hour. Without a store
 *    the recordings wait.
 */
export async function sweepCalls(deps: CallsSweepDeps): Promise<CallsSweepResult> {
  const log = deps.logger ?? appLogger;
  const now = deps.now ?? (() => new Date());
  const started = now().getTime();
  const spent = () => deps.budgetMs !== undefined && now().getTime() - started >= deps.budgetMs;
  const result: CallsSweepResult = {
    companies: 0,
    dialsClosed: 0,
    recordingsRemoved: 0,
    failures: 0,
  };
  const call = (entityId: number) => ({ entityIds: [entityId], requestId: deps.requestId });
  const failed = (event: string, fields: Record<string, unknown>) => {
    result.failures += 1;
    log.log('error', event, { requestId: deps.requestId, ...fields });
  };

  for (let entityId = 1; !spent(); entityId += 1) {
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      call(entityId),
      (ctx) => companyStanding(ctx, entityId),
      { name: 'calls.sweep.company' },
    );
    if (standing === 'missing') break;
    result.companies += 1;

    // 1. Dials the provider never took, and calls whose end never came.
    const unplacedBefore = new Date(now().getTime() - UNPLACED_DIAL_MINUTES * 60_000);
    const openBefore = new Date(now().getTime() - OPEN_CALL_HOURS * 3_600_000);
    const unplaced = await executeQuery(
      principal,
      call(entityId),
      (ctx) => unendedProviderCalls(ctx, unplacedBefore, openBefore, PAGE),
      { name: 'calls.sweep.unended', pool: 'app_user' },
    );
    for (const dial of unplaced) {
      try {
        const recorded = await executeCommand(principal, call(entityId), recordProviderCall, {
          entityId,
          providerCallId: dial.id,
          status: 'failed',
          endedAt: now().toISOString(),
        });
        if (recorded.outcome === 'moved') result.dialsClosed += 1;
      } catch (error) {
        failed('calls.sweep_close_failed', { entityId, providerCallId: dial.id, error });
      }
    }

    // 2. Recordings past the retention period.
    if (deps.store === undefined) continue;
    const before = monthsBefore(now(), WORKSHOP_DEFAULTS.retention.callRecordingMonths);
    const due = await executeQuery(
      principal,
      call(entityId),
      (ctx) => dueCallRecordings(ctx, before, PAGE),
      { name: 'calls.sweep.recordings', pool: 'app_user' },
    );
    for (const recording of due) {
      // A recording kept in another store is that store's to remove.
      if (recording.bucket !== deps.store.bucket) continue;
      try {
        await deps.store.delete(recording.key);
        const removed = await executeCommand(principal, call(entityId), deleteCallRecording, {
          entityId,
          fileId: recording.fileId,
        });
        if (removed.deleted) result.recordingsRemoved += 1;
      } catch (error) {
        failed('calls.sweep_recording_failed', { entityId, fileId: recording.fileId, error });
      }
    }
  }
  log.log('info', 'calls.sweep_run', { requestId: deps.requestId, ...result });
  return result;
}
