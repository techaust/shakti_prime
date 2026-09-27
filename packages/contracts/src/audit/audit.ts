import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { PrincipalKindSchema } from '../principal';

/** How a recorded action ended (docs/design/backend-weeks-3-5.md §3.2). */
export const AUDIT_OUTCOMES = ['ok', 'denied', 'failed'] as const;
export const AuditOutcomeSchema = z.enum(AUDIT_OUTCOMES);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

/**
 * Sign-in and account events the auth module records. They run outside the command runner,
 * because their state lives in tables only the auth module writes; every name starts `auth.`,
 * which is the only prefix the auth connection may write (migration 0033).
 */
export const AUTH_AUDIT_EVENTS = [
  'auth.sign_in',
  'auth.two_factor.verify',
  'auth.sign_out',
  'auth.password.reset_requested',
  'auth.password.set',
  'auth.password.change',
  'auth.two_factor.enable',
  'auth.backup_codes.regenerate',
] as const;
export const AuthAuditEventSchema = z.enum(AUTH_AUDIT_EVENTS);
export type AuthAuditEvent = z.infer<typeof AuthAuditEventSchema>;

/** Postgres text form of a timestamp, so a cursor loses no microsecond. */
const PgTimestampText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/);

/** The keyset position of the audit reader: the last row's `(created_at, id)`. */
export const AuditCursorSchema = z.object({ createdAt: PgTimestampText, id: IdSchema }).strict();

/** Filters of the audit reader (`audit.query`). The window is required and at most 93 days. */
export const AuditQueryInput = z
  .object({
    entityId: EntityIdSchema.optional(),
    aggregateType: z.string().min(1).max(64).optional(),
    aggregateId: z.string().min(1).max(64).optional(),
    actorPrincipalId: IdSchema.optional(),
    command: z.string().min(1).max(96).optional(),
    outcome: AuditOutcomeSchema.optional(),
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), {
    message: 'from must be before to',
    path: ['to'],
  })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 93 * 24 * 60 * 60 * 1000, {
    message: 'the window is at most 93 days',
    path: ['from'],
  });
export type AuditQueryInput = z.input<typeof AuditQueryInput>;

/** One audit row as the Admin audit screen sees it; values were redacted when written. */
export const AuditLogDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema.nullable(),
    actorPrincipalId: IdSchema.nullable(),
    actorKind: PrincipalKindSchema.nullable(),
    /** The actor's display name, for the screen; null for a row with no actor. */
    actorName: z.string().nullable(),
    onBehalfOfUserId: IdSchema.nullable(),
    command: z.string(),
    aggregateType: z.string().nullable(),
    aggregateId: z.string().nullable(),
    outcome: AuditOutcomeSchema,
    errorCode: z.string().nullable(),
    input: z.unknown(),
    before: z.unknown(),
    after: z.unknown(),
    ip: z.string().nullable(),
    device: z.string().nullable(),
    requestId: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type AuditLogDto = z.infer<typeof AuditLogDto>;

export const AuditPageDto = z
  .object({ items: z.array(AuditLogDto), nextCursor: z.string().nullable() })
  .strict();
export type AuditPageDto = z.infer<typeof AuditPageDto>;

/** The window of the Activity log's person filter: the same limits as the reader's window. */
export const AuditPeopleInput = z
  .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
  .strict()
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), {
    message: 'from must be before to',
    path: ['to'],
  })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 93 * 24 * 60 * 60 * 1000, {
    message: 'the window is at most 93 days',
    path: ['from'],
  });
export type AuditPeopleInput = z.input<typeof AuditPeopleInput>;

/** Someone who acted in the window, for the person filter of the Activity log. */
export const AuditPersonDto = z.object({ id: IdSchema, name: z.string() }).strict();
export type AuditPersonDto = z.infer<typeof AuditPersonDto>;
export const AuditPeopleDto = z.array(AuditPersonDto);
export type AuditPeopleDto = z.infer<typeof AuditPeopleDto>;
