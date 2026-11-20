import { idTime, type DueWhatsAppMediaDto, type MediaRetentionCursor } from '@shakti/contracts';
import {
  companyStanding,
  dueWhatsAppMedia,
  executeCommand,
  executeQuery,
  expireWhatsAppMedia,
  MEDIA_KEYS_MAX,
  recordWhatsAppMediaOrphans,
  whatsAppMediaKeysKept,
  type FileStore,
  type Logger,
} from '@shakti/domain';
import { logger as appLogger } from '../log';
import { systemWorkersPrincipal } from './events/system-principal';

/** Messages one batch looks at: one query, at most 200 deletions and one removal record. */
export const MEDIA_RETENTION_BATCH = 200;

/** How old a key no file names must be before it goes: a try under way stores before it attaches. */
export const ORPHAN_MIN_AGE_HOURS = 24;

/**
 * How far back each run looks for keys no file names. A key's name starts with its file's
 * UUIDv7 id, so keys list in the order they were made and a run lists only this window of a
 * company's folder, not three years of photos; a key stays in the window for 29 nights after it
 * is a day old, so a run that fails for weeks still finds it.
 */
export const ORPHAN_LOOKBACK_DAYS = 30;

const DAY_MS = 86_400_000;

/** Where a run starts, or where the next call carries on. */
export type MediaRetentionPlace =
  | { entityId: number; step: 'expire'; after: MediaRetentionCursor | null }
  | { entityId: number; step: 'orphans'; afterKey: string | null; startedAt: string };

export interface MediaRetentionDeps {
  /** The environment's store; without one nothing is removed (a dry run still counts files). */
  store: FileStore | undefined;
  requestId: string;
  /** Count what would go and change nothing. */
  dryRun?: boolean;
  /** Where to start; the first company's first batch when left out. */
  start?: MediaRetentionPlace;
  /** Start no new batch or page after this long; the place reached is answered as `next`. */
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
  /** Where the next call carries on, when the time ran out; null when every company is done. */
  next: MediaRetentionPlace | null;
}

/** The first characters of the key of a file made at `at`: the time part of a UUIDv7. */
export function uuidTimePrefix(at: Date): string {
  const hex = Math.max(0, Math.trunc(at.getTime())).toString(16).padStart(12, '0').slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8)}`;
}

/** When the file a key under a WhatsApp folder belongs to was made, from its id; else undefined. */
function keyTime(key: string): Date | undefined {
  const id = /\/whatsapp_media\/([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
    key,
  )?.[1];
  return id === undefined ? undefined : idTime(id);
}

/** Every key a due file may hold: its bytes, the upload's own key, and a PDF's masked pages. */
async function fileKeys(store: FileStore, due: DueWhatsAppMediaDto): Promise<string[]> {
  const keys = [due.key];
  if (due.originalKey !== null && due.originalKey !== due.key) keys.push(due.originalKey);
  if (due.contentType === 'application/pdf') {
    const stem = (due.originalKey ?? due.key).replace(/\.[A-Za-z0-9]+$/, '').replace(/-checked$/, '');
    for (let after: string | undefined; ; ) {
      const page = await store.list(`${stem}-checked/`, after === undefined ? {} : { after });
      keys.push(...page.keys.map((k) => k.key));
      if (page.next === undefined) break;
      after = page.next;
    }
  }
  return keys;
}

/**
 * The WhatsApp media retention job (docs/03-roadmap-appendix/phase2.md §11, BLUEPRINT §7.9), run
 * by the worker principal (`system:workers`, the platform-only `messaging.media.expire`) for each
 * company in turn, in a request for that company alone:
 * 1. media messages that arrived more than `WORKSHOP_DEFAULTS.retention.whatsappMediaYears` ago
 *    whose file is still kept, a batch at a time by a keyset cursor (`dueWhatsAppMedia`): each
 *    file no other record uses has every key of its own deleted from the store (its bytes, the
 *    upload the checks replaced, a PDF's masked pages), then the batch is recorded
 *    (`messaging.media.expire`): the file's row marked deleted, the message's summary written, the
 *    batch one row of `retention_runs`. A file the store refuses is never recorded removed while
 *    its bytes remain; it is counted as the batch's error and waits for the next run. A file
 *    another record uses is kept and passed by.
 * 2. keys under the company's WhatsApp folder made in the last `ORPHAN_LOOKBACK_DAYS` days, more
 *    than a day old, that no file names (an original a stopped try stored and never attached, or
 *    one the checks left behind; `whatsAppMediaKeysKept`) are deleted, and the sweep recorded
 *    (`messaging.media.record_orphans`).
 * A dry run counts both and changes nothing, records nothing. When the time is spent, the place
 * reached is answered as `next`, for the next call to start from. Log lines carry ids and counts,
 * never a customer's details.
 */
export async function runWhatsAppMediaRetention(
  deps: MediaRetentionDeps,
): Promise<MediaRetentionResult> {
  const log = deps.logger ?? appLogger;
  const now = deps.now ?? (() => new Date());
  const dryRun = deps.dryRun === true;
  const batchSize = Math.min(Math.max(deps.batchSize ?? MEDIA_RETENTION_BATCH, 1), 500);
  const started = now().getTime();
  const spent = () => deps.budgetMs !== undefined && now().getTime() - started >= deps.budgetMs;
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
    next: null,
  };
  const { store } = deps;
  const scope = (entityId: number) => ({ entityIds: [entityId], requestId: deps.requestId });
  const finish = (next: MediaRetentionPlace | null): MediaRetentionResult => {
    result.next = next;
    log.log('info', next === null ? 'messaging.media_retention_run' : 'messaging.media_retention_continued', {
      requestId: deps.requestId,
      ...result,
    });
    return result;
  };
  if (store === undefined && !dryRun) {
    log.log('warn', 'messaging.media_retention_no_store', { requestId: deps.requestId });
    return finish(null);
  }

  let place: MediaRetentionPlace = deps.start ?? { entityId: 1, step: 'expire', after: null };
  for (;;) {
    const { entityId } = place;
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      scope(entityId),
      (ctx) => companyStanding(ctx, entityId),
      { name: 'messaging.media_retention.company' },
    );
    if (standing === 'missing') return finish(null);
    result.companies += 1;

    // 1. Files past the retention period, a batch at a time.
    if (place.step === 'expire') {
      let after = place.after;
      for (;;) {
        if (spent()) return finish({ entityId, step: 'expire', after });
        const due = await executeQuery(
          principal,
          scope(entityId),
          (ctx) => dueWhatsAppMedia(ctx, entityId, after, batchSize),
          { name: 'messaging.media_retention.due', pool: 'app_user' },
        );
        if (due.length === 0) break;
        result.batches += 1;
        result.examined += due.length;
        const removable = due.filter((d) => !d.inUse);
        result.inUse += due.length - removable.length;
        if (dryRun) {
          result.removed += removable.length;
        } else if (store !== undefined) {
          const deleted: string[] = [];
          let failed = 0;
          for (const file of removable) {
            // A file kept in another store is that store's to remove.
            if (file.bucket !== store.bucket) {
              result.otherStore += 1;
              continue;
            }
            try {
              for (const key of await fileKeys(store, file)) await store.delete(key);
              deleted.push(file.messageId);
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
        }
        const last = due.at(-1);
        if (due.length < batchSize || last === undefined) break;
        after = { at: last.messageAt, id: last.messageId };
      }
      place = { entityId, step: 'orphans', afterKey: null, startedAt: now().toISOString() };
    }

    // 2. Keys no file names, made in the window and more than a day old.
    if (store !== undefined) {
      const folder = `${String(entityId)}/whatsapp_media/`;
      const youngest = now().getTime() - ORPHAN_MIN_AGE_HOURS * 3_600_000;
      let afterKey =
        place.afterKey ?? `${folder}${uuidTimePrefix(new Date(now().getTime() - ORPHAN_LOOKBACK_DAYS * DAY_MS))}`;
      let removed = 0;
      let failed = 0;
      for (;;) {
        if (spent()) {
          result.orphansRemoved += removed;
          result.orphansFailed += failed;
          if (!dryRun && (removed > 0 || failed > 0)) {
            await executeCommand(principal, scope(entityId), recordWhatsAppMediaOrphans, {
              entityId,
              startedAt: place.startedAt,
              removed,
              failed,
            });
          }
          return finish({ entityId, step: 'orphans', afterKey, startedAt: place.startedAt });
        }
        const page = await store.list(folder, { after: afterKey, limit: MEDIA_KEYS_MAX });
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
        for (const key of old.filter((k) => !kept.has(k))) {
          if (dryRun) {
            removed += 1;
            continue;
          }
          try {
            await store.delete(key);
            removed += 1;
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
        if (tooYoung !== -1 || page.next === undefined) break;
        afterKey = page.next;
      }
      result.orphansRemoved += removed;
      result.orphansFailed += failed;
      if (!dryRun) {
        await executeCommand(principal, scope(entityId), recordWhatsAppMediaOrphans, {
          entityId,
          startedAt: place.startedAt,
          removed,
          failed,
        });
      }
    }
    place = { entityId: entityId + 1, step: 'expire', after: null };
  }
}
