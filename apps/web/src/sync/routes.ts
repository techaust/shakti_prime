import {
  API_HEADERS,
  IdempotencyKeySchema,
  SyncPullQuery,
  SyncPushRequest,
  SyncPushResponse,
} from '@shakti/contracts';
import { executeQuery, syncPull, syncPush, type ExecuteOptions } from '@shakti/domain';
import { createHash, createHmac } from 'node:crypto';
import { apiFailure } from '../api-failure';
import { clientMeta } from '../auth/client-address';
import { signingSetup } from '../auth/mobile-bearer';
import { withCaller, type MobileRouteDeps } from '../auth/mobile-routes';
import { declaredTooLarge, readTextWithin } from '../request-body';

/**
 * The field app's sync routes (docs/06-api.md §3.2, docs/03-roadmap-appendix/phase4.md §7.4):
 * `GET /api/v1/sync/pull` and `POST /api/v1/sync/push`, behind the mobile routes' front (the
 * version gate first, then the bearer, the phone still signed in, the caps and the person), each
 * reading or writing inside `withRequestContext()` as the person through the domain's sync
 * engine. Nothing of a record, a cursor or a command's input is logged.
 */

/** A push of 100 commands; a survey's answers are the largest input a command takes. */
export const SYNC_PUSH_BODY_MAX_BYTES = 512 * 1024;

/** How long a batch's own key is kept, to refuse it with other commands: the front's day. */
export const SYNC_BATCH_KEY_SECONDS = 24 * 60 * 60;

export interface SyncRouteDeps extends MobileRouteDeps {
  /** The command options every pushed command runs with: the outbox nudge. */
  executeOptions: (meta: { client: ExecuteOptions['client'] }) => ExecuteOptions;
}

const NO_STORE = { 'cache-control': 'no-store' };

function answer(body: unknown, requestId: string): Response {
  return Response.json(body, { headers: { ...NO_STORE, 'x-request-id': requestId } });
}

/**
 * The key pull cursors are signed with: derived from the field app's own key pair, under a label
 * of its own, so it changes with the pair and signs nothing else.
 */
export function syncCursorKey(refreshKey: Uint8Array): Buffer {
  return createHmac('sha256', refreshKey).update('shakti-sync-cursor\n').digest();
}

/** `GET /api/v1/sync/pull?since=&limit=`: the changes since the cursor, a page at a time. */
export function syncPullRoute(request: Request, deps: SyncRouteDeps): Promise<Response> {
  return withCaller(request, deps, 'sync.pull_failed', async ({ principal }, requestId) => {
    const params = new URL(request.url).searchParams;
    const query = SyncPullQuery.safeParse({
      ...(params.has('since') ? { since: params.get('since') } : {}),
      ...(params.has('limit') ? { limit: params.get('limit') } : {}),
    });
    if (!query.success) return apiFailure('validation_failed', requestId);
    const setup = await signingSetup(deps.env ?? process.env);
    if ('kind' in setup) return apiFailure(setup.code, requestId);
    const outcome = await executeQuery(
      principal,
      { entityIds: principal.entityIds, requestId },
      syncPull({
        since: query.data.since,
        limit: query.data.limit,
        cursorKey: syncCursorKey(setup.keys.refreshKey),
      }),
      { name: 'syncPull' },
    );
    if (outcome.kind === 'cursor_expired') {
      return apiFailure('validation_failed', requestId, { reason: 'cursor_expired' });
    }
    return answer(outcome.response, requestId);
  });
}

/**
 * `POST /api/v1/sync/push`: the commands recorded offline, in order. The batch carries its own
 * `Idempotency-Key`: the same batch sent again runs again (each command replays from its own key),
 * and the key with other commands is refused (`idempotency_mismatch`).
 */
export function syncPushRoute(request: Request, deps: SyncRouteDeps): Promise<Response> {
  return withCaller(request, deps, 'sync.push_failed', async ({ principal }, requestId) => {
    const key = IdempotencyKeySchema.safeParse(request.headers.get(API_HEADERS.idempotencyKey));
    if (!key.success) return apiFailure('validation_failed', requestId);
    if (declaredTooLarge(request.headers, SYNC_PUSH_BODY_MAX_BYTES)) {
      return apiFailure('validation_failed', requestId);
    }
    const text = await readTextWithin(request, SYNC_PUSH_BODY_MAX_BYTES).catch(() => undefined);
    if (text === undefined) return apiFailure('validation_failed', requestId);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return apiFailure('validation_failed', requestId);
    }
    const parsed = SyncPushRequest.safeParse(body);
    if (!parsed.success) return apiFailure('validation_failed', requestId);

    const batchHash = createHash('sha256').update(JSON.stringify(parsed.data)).digest('hex');
    const batchKey = `sync-push:${principal.id}:${key.data}`;
    const fresh = await deps.keyValue.setIfAbsent(batchKey, batchHash, SYNC_BATCH_KEY_SECONDS);
    if (!fresh && (await deps.keyValue.get(batchKey)) !== batchHash) {
      return apiFailure('conflict', requestId, { reason: 'idempotency_mismatch' });
    }

    const results = await syncPush(principal, parsed.data.commands, {
      requestId,
      execute: {
        ...deps.executeOptions({ client: clientMeta(request.headers) }),
        idempotencyFront: deps.keyValue,
        logger: deps.logger,
      },
    });
    const now = (deps.now ?? (() => new Date()))();
    return answer(SyncPushResponse.parse({ results, serverTime: now.toISOString() }), requestId);
  });
}
