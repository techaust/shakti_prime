import {
  DeadLetteredEvent,
  IdSchema,
  IntegrationHealthQuery,
  OutboxTypeHealth,
  type DeadLetteredEvent as DeadLetter,
  type OutboxTypeHealth as TypeHealth,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

/** The outbox part of Integration Health (docs/API.md §3.7, docs/design/phase1.md §5.2). */
export interface OutboxHealth {
  byType: TypeHealth[];
  deadLetters: { total: number; items: DeadLetter[]; nextCursor: string | null };
}

/**
 * The position after a page's last dead letter: its `dead_lettered_at` as Postgres text, so no
 * microsecond is lost, and its id.
 */
const CursorBody = z
  .object({
    at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/),
    id: IdSchema,
  })
  .strict();

const Instant = z.string().transform((value) => new Date(value).toISOString());

/** What `app.outbox_health()` answers; its times are Postgres JSON, read back as ISO 8601. */
const Answer = z.object({
  byType: z.array(
    z.object({
      type: z.string(),
      pending: z.number(),
      due: z.number(),
      deadLettered: z.number(),
      oldestPendingAt: Instant.nullable(),
    }),
  ),
  deadLetters: z.object({
    total: z.number(),
    items: z.array(
      z.object({
        eventId: z.string(),
        type: z.string(),
        entityId: z.number(),
        aggregateType: z.string(),
        aggregateId: z.string(),
        attempts: z.number(),
        errorCode: z.string().nullable(),
        createdAt: Instant,
        deadLetteredAt: Instant,
        cursorAt: z.string(),
      }),
    ),
  }),
});

/**
 * The outbox by event type and one page of dead letters, newest first, for the request's
 * companies. `app_user` reads no outbox row, so this goes through the definer
 * `app.outbox_health()`, which checks `admin.integrations.write:all` itself and answers counts,
 * ids, types, attempts, error codes and times, never a payload (migration 0062).
 */
export async function readOutboxHealth(
  ctx: Pick<RequestContext, 'tx'>,
  raw: unknown = {},
): Promise<OutboxHealth> {
  const input = parseQueryInput(IntegrationHealthQuery, raw, 'readOutboxHealth');
  const after = input.cursor === undefined ? undefined : decodeCursor(CursorBody, input.cursor);
  const rows = (await ctx.tx.execute(sql`
    select app.outbox_health(${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid,
                             ${input.limit}::int) as health`)) as unknown as { health: unknown }[];
  const answer = Answer.parse(rows[0]?.health);
  const page = answer.deadLetters.items.slice(0, input.limit);
  const last = page.at(-1);
  const more = answer.deadLetters.items.length > input.limit && last !== undefined;
  return {
    byType: answer.byType.map((t) => OutboxTypeHealth.parse(t)),
    deadLetters: {
      total: answer.deadLetters.total,
      items: page.map(({ cursorAt: _cursorAt, ...item }) => DeadLetteredEvent.parse(item)),
      nextCursor: more ? encodeCursor({ at: last.cursorAt, id: last.eventId }) : null,
    },
  };
}
