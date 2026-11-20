import {
  idTime,
  WhatsAppMediaRetentionResponse,
  type DueWhatsAppMediaDto,
  type LeadAnonymiseWorkerBody,
  type LeadAnonymiseWorkerResponse,
  type MediaRetentionCursor,
} from '@shakti/contracts';
import {
  companyStanding,
  dueWhatsAppMedia,
  executeCommand,
  executeQuery,
  expireWhatsAppMedia,
  MEDIA_KEYS_MAX,
  recordWhatsAppMediaOrphans,
  whatsAppMediaKeysKept,
  whatsAppMediaOrphansLast,
  type FileStore,
  type Logger,
} from '@shakti/domain';
import { fileStore } from '../files/store';
import { logger as appLogger } from '../log';
import { systemWorkersPrincipal } from './events/system-principal';
import { runLeadAnonymise, type LeadAnonymiseOptions } from './lead-anonymise';

/** Messages one batch looks at: one query, at most 200 deletions and one removal record. */
export const MEDIA_RETENTION_BATCH = 200;

/** How old a key no file names must be before it goes: a try under way stores before it attaches. */
export const ORPHAN_MIN_AGE_HOURS = 24;

/**
 * How far before its last complete sweep a company's next sweep starts again. A key's name starts
 * with its file's UUIDv7 id, so keys list in the order they were made and a sweep lists only the
 * keys made since the last one, not three years of photos; the week again covers a file whose
 * checks finished late and left its upload behind under an older id.
 */
export const ORPHAN_RECHECK_DAYS = 7;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface MediaRetentionDeps {
  /** The environment's store; without one nothing is removed (a dry run still counts files). */
  store: FileStore | undefined;
  requestId: string;
  /** Count what would go and change nothing, record nothing. */
  dryRun?: boolean;
  /** Remove the files past the retention period (step 2); on when left out. */
  expire?: boolean;
  /** Sweep the keys no file names (step 1); on when left out. */
  orphans?: boolean;
  /** The run's whole time, shared fairly between the companies; unlimited when left out. */
  budgetMs?: number;
  batchSize?: number;
  logger?: Logger;
  now?: () => Date;
}

export interface MediaRetentionResult {
  dryRun: boolean;
  companies: number;
  batches: number;
  /** Media messages past the period looked at. */
  examined: number;
  /** Files removed (in a dry run, those that would be). */
  removed: number;
  /** Files kept because another record uses them. */
  inUse: number;
  /** Files kept in another store than this one, that store's to remove. */
  otherStore: number;
  /** Files whose bytes the store refused to delete; each waits for the next run. */
  failed: number;
  /** Keys no file names that were removed (in a dry run, that would be). */
  orphansRemoved: number;
  orphansFailed: number;
  /** Whether every company's steps reached their end; when not, the next run goes on. */
  done: boolean;
}

/** The first characters of the key of a file made at `at`: the time part of a UUIDv7. */
export function uuidTimePrefix(at: Date): string {
  const hex = Math.max(0, Math.trunc(at.getTime())).toString(16).padStart(12, '0').slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8)}`;
}

/** When the file a key under a WhatsApp folder belongs to was made, from its id; else undefined. */
function keyTime(key: string): Date | undefined {
  const id =
    /\/whatsapp_media\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
      key,
    )?.[1];
  return id === undefined ? undefined : idTime(id);
}

/** Every key a due file may hold: its bytes, the upload's own key, and a PDF's masked pages. */
async function fileKeys(store: FileStore, due: DueWhatsAppMediaDto): Promise<string[]> {
  const keys = [due.key];
  if (due.originalKey !== null && due.originalKey !== due.key) keys.push(due.originalKey);
  if (due.contentType === 'application/pdf') {
    const stem = (due.originalKey ?? due.key)
      .replace(/\.[A-Za-z0-9]+$/, '')
      .replace(/-checked$/, '');
    for (let after: string | undefined; ;) {
      const page = await store.list(`${stem}-checked/`, after === undefined ? {} : { after });
      keys.push(...page.keys.map((k) => k.key));
      if (page.next === undefined) break;
      after = page.next;
    }
  }
  return keys;
}

/**
 * Where a company's sweep starts: after the key its last sweep stopped at, else a week before
 * that sweep began less the day a key waits, else the whole folder (`undefined`).
 */
export function sweepStart(
  folder: string,
  last: { startedAt: string; resumeKey: string | null } | null,
): string | undefined {
  if (last === null) return undefined;
  if (last.resumeKey !== null) return last.resumeKey;
  const from =
    Date.parse(last.startedAt) - ORPHAN_MIN_AGE_HOURS * HOUR_MS - ORPHAN_RECHECK_DAYS * DAY_MS;
  return `${folder}${uuidTimePrefix(new Date(from))}`;
}

/**
 * The WhatsApp media retention job (docs/03-roadmap-appendix/phase2.md §11, BLUEPRINT §7.9), run
 * by the worker principal (`system:workers`, the platform-only `messaging.media.expire`) in a
 * request for one company at a time. The run's time is shared fairly: the live companies are
 * listed first, the orphan sweep takes half the time (all of it when the removal is off) and the
 * removal the rest, and each company gets an equal share of what is left when its turn comes, so
 * one company's backlog never keeps the others or the sweep from running; time a company leaves
 * goes to the next.
 * 1. The orphan sweep (`orphans`): the keys under the company's WhatsApp folder more than a day
 *    old that no file names (an original a stopped try stored and never attached, or one the
 *    checks left behind; `whatsAppMediaKeysKept`) are deleted. A sweep starts where the company's
 *    last good sweep left off (`whatsAppMediaOrphansLast`, `sweepStart`), or at the folder's
 *    start when there is none, and goes on until the keys are a day young; each sweep is recorded
 *    (`messaging.media.record_orphans`), with the last key it examined when its time ran out, and
 *    a sweep the store refused a key in is not a good sweep, so the next one covers its keys again.
 * 2. The removal (`expire`): media messages that arrived more than
 *    `WORKSHOP_DEFAULTS.retention.whatsappMediaYears` ago whose file is still kept, a batch at a
 *    time by a keyset cursor (`dueWhatsAppMedia`): each file no other record uses has every key of
 *    its own deleted from the store (its bytes, the upload the checks replaced, a PDF's masked
 *    pages), then the batch is recorded (`messaging.media.expire`). A file the store refuses is
 *    never recorded removed while its bytes remain; it waits for the next run. A removed file
 *    leaves the job's index, so each run starts again from the oldest file still kept.
 * The time is checked before each batch, page, file and key. A dry run counts both steps and
 * changes nothing, records nothing. When the run tried to remove anything and the store removed
 * none of it, the run fails once its records are written, so the failure streak and the jobs check
 * raise it (`job.failing`). Log lines carry ids, keys and counts, never a customer's details.
 */
export async function runWhatsAppMediaRetention(
  deps: MediaRetentionDeps,
): Promise<MediaRetentionResult> {
  const log = deps.logger ?? appLogger;
  const now = deps.now ?? (() => new Date());
  const clock = () => now().getTime();
  const dryRun = deps.dryRun === true;
  const expireOn = deps.expire !== false;
  const batchSize = Math.min(Math.max(deps.batchSize ?? MEDIA_RETENTION_BATCH, 1), 500);
  const started = clock();
  const deadline = deps.budgetMs === undefined ? Infinity : started + deps.budgetMs;
  const result: MediaRetentionResult = {
    dryRun,
    companies: 0,
    batches: 0,
    examined: 0,
    removed: 0,
    inUse: 0,
    otherStore: 0,
    failed: 0,
    orphansRemoved: 0,
    orphansFailed: 0,
    done: true,
  };
  const { store } = deps;
  const orphansOn = deps.orphans !== false && store !== undefined;
  const scope = (entityId: number) => ({ entityIds: [entityId], requestId: deps.requestId });
  if (store === undefined && !dryRun) {
    log.log('warn', 'messaging.media_retention_no_store', { requestId: deps.requestId });
    return result;
  }

  // The live companies, archived ones included: their customers' files are kept no longer.
  const companies: number[] = [];
  for (let entityId = 1; ; entityId += 1) {
    const standing = await executeQuery(
      systemWorkersPrincipal(entityId),
      scope(entityId),
      (ctx) => companyStanding(ctx, entityId),
      { name: 'messaging.media_retention.company' },
    );
    if (standing === 'missing') break;
    companies.push(entityId);
  }
  result.companies = companies.length;

  /** Each company's turn ends at an equal share of the step's time left. */
  const shares = async (
    stepEnd: number,
    run: (entityId: number, until: number) => Promise<boolean>,
  ): Promise<void> => {
    for (const [i, entityId] of companies.entries()) {
      const left = stepEnd - clock();
      const until = left === Infinity ? Infinity : clock() + left / (companies.length - i);
      if (!(await run(entityId, until))) result.done = false;
    }
  };

  // Attempts and successes of every removal, for the run's own failure (L7).
  let tried = 0;
  let succeeded = 0;

  // 1. Keys no file names, from where each company's last good sweep left off.
  if (orphansOn) {
    const stepEnd =
      deadline === Infinity || !expireOn ? deadline : started + (deadline - started) / 2;
    await shares(stepEnd, async (entityId, until) => {
      const principal = systemWorkersPrincipal(entityId);
      const folder = `${String(entityId)}/whatsapp_media/`;
      const startedAt = now().toISOString();
      const last = await executeQuery(
        principal,
        scope(entityId),
        (ctx) => whatsAppMediaOrphansLast(ctx, entityId),
        { name: 'messaging.media_retention.last_sweep', pool: 'app_user' },
      );
      let after = sweepStart(folder, last);
      let examined: string | undefined;
      let removed = 0;
      let failed = 0;
      const record = async (resumeKey: string | null) => {
        result.orphansRemoved += removed;
        result.orphansFailed += failed;
        if (dryRun) return;
        await executeCommand(principal, scope(entityId), recordWhatsAppMediaOrphans, {
          entityId,
          startedAt,
          removed,
          failed,
          resumeKey,
        });
      };
      for (;;) {
        if (clock() >= until) {
          // Stopped for time: the next sweep goes on after the last key examined.
          if (examined !== undefined) await record(examined);
          return false;
        }
        const page = await store.list(folder, {
          ...(after === undefined ? {} : { after }),
          limit: MEDIA_KEYS_MAX,
        });
        const youngest = clock() - ORPHAN_MIN_AGE_HOURS * HOUR_MS;
        // Keys list in the order their files were made: past the first one made within the
        // day, every later key is too young.
        const tooYoung = page.keys.findIndex(
          (k) => (keyTime(k.key)?.getTime() ?? k.storedAt.getTime()) >= youngest,
        );
        const window = tooYoung === -1 ? page.keys : page.keys.slice(0, tooYoung);
        const old = window.filter((k) => k.storedAt.getTime() < youngest).map((k) => k.key);
        const kept = await executeQuery(
          principal,
          scope(entityId),
          (ctx) => whatsAppMediaKeysKept(ctx, entityId, store.bucket, old),
          { name: 'messaging.media_retention.keys', pool: 'app_user' },
        );
        const orphans = new Set(old.filter((k) => !kept.has(k)));
        for (const { key } of window) {
          if (clock() >= until) {
            if (examined !== undefined) await record(examined);
            return false;
          }
          if (orphans.has(key)) {
            if (dryRun) {
              removed += 1;
            } else {
              tried += 1;
              try {
                await store.delete(key);
                removed += 1;
                succeeded += 1;
              } catch (error) {
                failed += 1;
                log.log('error', 'messaging.media_retention_orphan_failed', {
                  requestId: deps.requestId,
                  entityId,
                  key,
                  error,
                });
              }
            }
          }
          examined = key;
        }
        if (tooYoung !== -1 || page.next === undefined) {
          await record(null);
          return true;
        }
        after = page.next;
      }
    });
  }

  // 2. Files past the retention period, a batch at a time.
  if (expireOn) {
    await shares(deadline, async (entityId, until) => {
      const principal = systemWorkersPrincipal(entityId);
      let after: MediaRetentionCursor | null = null;
      for (;;) {
        if (clock() >= until) return false;
        const cursor: MediaRetentionCursor | null = after;
        const due: DueWhatsAppMediaDto[] = await executeQuery(
          principal,
          scope(entityId),
          (ctx) => dueWhatsAppMedia(ctx, entityId, cursor, batchSize),
          { name: 'messaging.media_retention.due', pool: 'app_user' },
        );
        if (due.length === 0) return true;
        result.batches += 1;
        result.examined += due.length;
        const removable = due.filter((d) => !d.inUse);
        result.inUse += due.length - removable.length;
        if (dryRun || store === undefined) {
          result.removed += removable.length;
        } else {
          const deleted: string[] = [];
          let failed = 0;
          let stopped = false;
          for (const file of removable) {
            // A file kept in another store is that store's to remove.
            if (file.bucket !== store.bucket) {
              result.otherStore += 1;
              continue;
            }
            if (clock() >= until) {
              stopped = true;
              break;
            }
            tried += 1;
            try {
              for (const key of await fileKeys(store, file)) await store.delete(key);
              deleted.push(file.messageId);
              succeeded += 1;
            } catch (error) {
              failed += 1;
              log.log('error', 'messaging.media_retention_delete_failed', {
                requestId: deps.requestId,
                entityId,
                fileId: file.fileId,
                error,
              });
            }
          }
          const recorded = await executeCommand(principal, scope(entityId), expireWhatsAppMedia, {
            entityId,
            messageIds: deleted,
            failed,
          });
          result.removed += recorded.removed.length;
          result.failed += failed;
          if (recorded.inUse > 0) {
            // Filed elsewhere between the read and the removal: its bytes are gone, its row kept.
            result.inUse += recorded.inUse;
            log.log('warn', 'messaging.media_retention_in_use_after_delete', {
              requestId: deps.requestId,
              entityId,
              inUse: recorded.inUse,
            });
          }
          if (stopped) return false;
        }
        const last = due.at(-1);
        if (due.length < batchSize || last === undefined) return true;
        after = { at: last.messageAt, id: last.messageId };
      }
    });
  }

  log.log('info', 'messaging.media_retention_run', { requestId: deps.requestId, ...result });
  if (tried > 0 && succeeded === 0) {
    throw new Error(`the store removed none of the ${String(tried)} files and keys it was given`);
  }
  return result;
}

/**
 * The switches (docs/03-roadmap-appendix/phase2.md §11), read at run time, each on only for the
 * value `on` and off when empty or anything else, on every environment, so merging the job deletes
 * nothing until the owner turns a step on where they choose:
 * - `WHATSAPP_MEDIA_RETENTION=on`: the removal of files past the retention period, which waits for
 *   the CA to confirm the period;
 * - `WHATSAPP_MEDIA_ORPHAN_SWEEP=on`: the sweep of keys no file names (unmasked originals a stopped
 *   try or the checks left behind), which waits for no one's period.
 * A dry run counts both with the switches off, since it changes nothing.
 */
export function mediaRetentionOn(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.WHATSAPP_MEDIA_RETENTION?.trim() === 'on';
}

export function mediaOrphanSweepOn(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.WHATSAPP_MEDIA_ORPHAN_SWEEP?.trim() === 'on';
}

/** Messages a nightly batch looks at: each file costs a few store calls, and the night's call has
 * a minute in all, so a batch started late still ends within it. */
export const NIGHTLY_MEDIA_BATCH = 50;

/** The longest the media job runs in the night's call. */
export const NIGHTLY_MEDIA_BUDGET_MS = 15_000;

/** The time from the call's start after which the media job starts nothing (of the route's 60 s). */
export const NIGHTLY_WORK_LIMIT_MS = 45_000;

export interface NightlyRetentionOptions extends LeadAnonymiseOptions {
  env?: Readonly<Record<string, string | undefined>>;
  store?: FileStore | undefined;
  logger?: Logger;
}

/**
 * The nightly retention call (`lead-anonymise`, its route and schedule unchanged): the leads'
 * anonymisation first (`runLeadAnonymise`), and in the call that finishes it the WhatsApp media
 * job's steps whose switch is on (both for a dry run), with the time left, at most
 * `NIGHTLY_MEDIA_BUDGET_MS`, shared fairly between the companies. Work a night leaves is the next
 * night's: a removed file leaves the job's index, and a sweep goes on from where the last one
 * stopped. A failure of either job fails the call, which counts towards the job's failure streak
 * and the jobs check (`job.failing`); the leads' work already done stays done.
 */
export async function runNightlyRetention(
  body: LeadAnonymiseWorkerBody,
  options: NightlyRetentionOptions = {},
): Promise<LeadAnonymiseWorkerResponse> {
  const clock = options.now ?? Date.now;
  const started = clock();
  const leads = await runLeadAnonymise(body, options);
  const dryRun = body.dryRun === true;
  const expire = dryRun || mediaRetentionOn(options.env);
  const orphans = dryRun || mediaOrphanSweepOn(options.env);
  if (!leads.done || (!expire && !orphans)) return leads;
  const budgetMs = Math.min(NIGHTLY_MEDIA_BUDGET_MS, NIGHTLY_WORK_LIMIT_MS - (clock() - started));
  if (budgetMs <= 0) return leads;
  const media = await runWhatsAppMediaRetention({
    store: 'store' in options ? options.store : fileStore(),
    requestId: options.requestId ?? 'nightly-retention',
    dryRun,
    expire,
    orphans,
    budgetMs,
    batchSize: NIGHTLY_MEDIA_BATCH,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return { ...leads, media: WhatsAppMediaRetentionResponse.parse(media) };
}
