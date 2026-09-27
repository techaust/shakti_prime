import {
  AuditCursorSchema,
  AuditPageDto,
  AuditPeopleDto,
  AuditPeopleInput,
  AuditQueryInput,
  DomainError,
  type AuditLogDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, gte, isNotNull, lt, or, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';

type AuditContext = Pick<RequestContext, 'tx' | 'principal'>;

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    return AuditCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor });
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

/**
 * `audit.query` (docs/design/backend-weeks-3-5.md §3.4): the audit trail newest first, keyset
 * paginated by `(created_at, id)`. RLS decides the rows: `audit.read` at entity scope reads its
 * entities, rows of no entity need `audit.read:all`. The window is required, so the planner
 * touches only the partitions of those months. Reading is not itself audited in this slice.
 */
export async function queryAudit(ctx: AuditContext, rawInput: unknown): Promise<AuditPageDto> {
  const parsed = AuditQueryInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError('validation_failed', 'invalid input for audit.query', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  const input = parsed.data;
  checkPermission(ctx.principal, 'audit.read', 'entity');
  const after = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const a = schema.auditLogs;

  const p = schema.principals;
  const rows = await ctx.tx
    .select({
      row: a,
      createdAtText: sql<string>`${a.createdAt}::text`,
      actorName: p.displayName,
    })
    .from(a)
    // Every signed-in person may read principals' names (migration 0002), so the join hides no row.
    .leftJoin(p, eq(p.id, a.actorPrincipalId))
    .where(
      and(
        gte(a.createdAt, new Date(input.from)),
        lt(a.createdAt, new Date(input.to)),
        input.entityId === undefined ? undefined : eq(a.entityId, input.entityId),
        input.aggregateType === undefined ? undefined : eq(a.aggregateType, input.aggregateType),
        input.aggregateId === undefined ? undefined : eq(a.aggregateId, input.aggregateId),
        input.actorPrincipalId === undefined
          ? undefined
          : eq(a.actorPrincipalId, input.actorPrincipalId),
        input.command === undefined ? undefined : eq(a.command, input.command),
        input.outcome === undefined ? undefined : eq(a.outcome, input.outcome),
        after === undefined
          ? undefined
          : or(
              lt(a.createdAt, sql`${after.createdAt}::timestamptz`),
              and(eq(a.createdAt, sql`${after.createdAt}::timestamptz`), lt(a.id, after.id)),
            ),
      ),
    )
    .orderBy(desc(a.createdAt), desc(a.id))
    .limit(input.limit + 1);

  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return AuditPageDto.parse({
    items: page.map(({ row, actorName }) => toAuditLogDto(row, actorName)),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor(last.createdAtText, last.row.id)
        : null,
  });
}

export function toAuditLogDto(
  row: typeof schema.auditLogs.$inferSelect,
  actorName: string | null = null,
): AuditLogDto {
  return {
    id: row.id,
    entityId: row.entityId,
    actorPrincipalId: row.actorPrincipalId,
    actorKind: row.actorKind as AuditLogDto['actorKind'],
    actorName,
    onBehalfOfUserId: row.onBehalfOfUserId,
    command: row.command,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    outcome: row.outcome as AuditLogDto['outcome'],
    errorCode: row.errorCode,
    input: row.inputJson,
    before: row.beforeJson,
    after: row.afterJson,
    ip: row.ip,
    device: row.device,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The people who acted in a window, by name, for the Activity log's person filter
 * (`audit.read`). Read from the audit rows themselves, so RLS offers only the people whose rows
 * the caller may see, and the window keeps the planner to those months' partitions.
 */
export async function listAuditPeople(
  ctx: AuditContext,
  rawInput: unknown,
): Promise<AuditPeopleDto> {
  const parsed = AuditPeopleInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError('validation_failed', 'invalid input for audit.people', {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  checkPermission(ctx.principal, 'audit.read', 'entity');
  const a = schema.auditLogs;
  const p = schema.principals;
  const rows = await ctx.tx
    .selectDistinct({ id: p.id, name: p.displayName })
    .from(a)
    .innerJoin(p, eq(p.id, a.actorPrincipalId))
    .where(
      and(
        gte(a.createdAt, new Date(parsed.data.from)),
        lt(a.createdAt, new Date(parsed.data.to)),
        isNotNull(a.actorPrincipalId),
      ),
    )
    .orderBy(asc(p.displayName), asc(p.id))
    .limit(500);
  return AuditPeopleDto.parse(rows);
}
