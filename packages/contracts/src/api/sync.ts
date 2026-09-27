import { z } from 'zod';
import { ErrorCodeSchema } from '../errors';
import { IdempotencyKeySchema, IdSchema } from '../ids';
import { CursorSchema } from './common';

/**
 * Field app sync (docs/API.md §3.2, docs/ARCHITECTURE.md §10, docs/BLUEPRINT.md §8.7). Pull brings
 * the engineer's working set changed since a server cursor; push sends the commands recorded
 * offline, applied in order through the command layer, each with its own idempotency key.
 */

/**
 * What the app keeps offline. Each record's shape is the DTO of its module, contracted with that
 * module in Phase 2; the sync envelope carries it as an object the app's local store validates.
 */
export const SYNC_COLLECTIONS = [
  'schedule_slots',
  'projects',
  'project_milestones',
  'customer_sites',
  'surveys',
  'survey_photos',
  'checklists',
  'qc_inspections',
  'material_issues',
  'attendance_sites',
  'expense_claims',
  'items',
  'reference',
] as const;
export const SyncCollectionSchema = z.enum(SYNC_COLLECTIONS);
export type SyncCollection = z.infer<typeof SyncCollectionSchema>;

/** `GET /sync/pull?since=<cursor>&limit=`: no cursor starts a full pull. */
export const SyncPullQuery = z
  .object({
    since: CursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(500),
  })
  .strict();
export type SyncPullQuery = z.infer<typeof SyncPullQuery>;

const SyncUpsert = z
  .object({
    op: z.literal('upsert'),
    collection: SyncCollectionSchema,
    id: IdSchema,
    updatedAt: z.iso.datetime(),
    record: z.record(z.string(), z.unknown()),
  })
  .strict();

/** A record the engineer no longer holds: removed, reassigned or out of the working window. */
const SyncDelete = z
  .object({
    op: z.literal('delete'),
    collection: SyncCollectionSchema,
    id: IdSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const SyncChange = z.discriminatedUnion('op', [SyncUpsert, SyncDelete]);
export type SyncChange = z.infer<typeof SyncChange>;

export const SyncPullResponse = z
  .object({
    changes: z.array(SyncChange),
    /** Opaque; the app stores it and sends it as `since` on the next pull. */
    nextCursor: CursorSchema,
    /** More changes are waiting; the app pulls again at once with `nextCursor`. */
    hasMore: z.boolean(),
    serverTime: z.iso.datetime(),
  })
  .strict();
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;

/** A command name as the registry knows it: `module.resource.action`. */
export const CommandNameSchema = z.string().regex(/^[a-z]+(\.[a-z_]+){1,4}$/);

/**
 * One command recorded offline. `id` is the client's UUIDv7 for the record the command creates or
 * touches; `clientTime` is when the engineer acted, used for per-field merges of survey answers.
 */
export const SyncCommand = z
  .object({
    id: IdSchema,
    name: CommandNameSchema,
    input: z.record(z.string(), z.unknown()),
    idempotencyKey: IdempotencyKeySchema,
    clientTime: z.iso.datetime(),
  })
  .strict();
export type SyncCommand = z.infer<typeof SyncCommand>;

/** `POST /sync/push`. The batch travels with its own `Idempotency-Key` header as well. */
export const SyncPushRequest = z
  .object({
    commands: z.array(SyncCommand).min(1).max(100),
  })
  .strict()
  .refine((v) => new Set(v.commands.map((c) => c.idempotencyKey)).size === v.commands.length, {
    message: 'each command carries its own idempotency key',
    path: ['commands'],
  });
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

/** Every result names the command by its idempotency key and the record it touched. */
const ResultBase = { idempotencyKey: IdempotencyKeySchema, id: IdSchema };

/** The command ran now. */
const SyncApplied = z
  .object({
    ...ResultBase,
    status: z.literal('applied'),
    output: z.record(z.string(), z.unknown()),
  })
  .strict();

/** The command ran on an earlier push; its stored answer is returned and nothing runs again. */
const SyncReplayed = z
  .object({
    ...ResultBase,
    status: z.literal('replayed'),
    output: z.record(z.string(), z.unknown()),
  })
  .strict();

/**
 * The server's record moved on while the app was offline (a status changed on the server, a
 * field was edited later). The app shows it on the conflict review screen with `server` beside
 * what the engineer entered.
 */
const SyncConflict = z
  .object({
    ...ResultBase,
    status: z.literal('conflict'),
    reason: z.enum(['state_changed', 'field_newer_on_server', 'record_removed', 'stock_short']),
    server: z.record(z.string(), z.unknown()).nullable(),
  })
  .strict();

/** The command cannot run as sent: not allowed, not valid or not found. */
const SyncRejected = z
  .object({
    ...ResultBase,
    status: z.literal('rejected'),
    error: z
      .object({
        code: ErrorCodeSchema,
        reason: z
          .string()
          .regex(/^[a-z_]+$/)
          .optional(),
      })
      .strict(),
  })
  .strict();

/**
 * A later command for the same record is not run while an earlier one in the batch conflicted or
 * was rejected; the app sends it again once the engineer resolves the first.
 */
const SyncHeld = z
  .object({
    ...ResultBase,
    status: z.literal('held'),
    blockedBy: IdempotencyKeySchema,
  })
  .strict();

export const SyncCommandResult = z.discriminatedUnion('status', [
  SyncApplied,
  SyncReplayed,
  SyncConflict,
  SyncRejected,
  SyncHeld,
]);
export type SyncCommandResult = z.infer<typeof SyncCommandResult>;

/** One result per command, in the order sent. */
export const SyncPushResponse = z
  .object({
    results: z.array(SyncCommandResult),
    serverTime: z.iso.datetime(),
  })
  .strict();
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;
