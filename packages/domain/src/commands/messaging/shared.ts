import {
  DomainError,
  WhatsAppHandoffReasonSchema,
  WhatsAppThreadDto,
  WhatsAppThreadHandlerSchema,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { maskIdentityNumbers } from '../../privacy/identity-numbers';

type ThreadRow = typeof schema.whatsappThreads.$inferSelect;

/**
 * Customer text on its way into `whatsapp_messages` (BLUEPRINT §7.5, SECURITY §5 and §6): every
 * Aadhaar and bank account number masked to its last four digits by the shared finder, whatever
 * the customer or a person typed. The runner has already masked a typed Aadhaar number in a
 * command's input; this adds the bank account numbers and the misread Aadhaar shapes the OCR
 * masking hides.
 */
export function maskMessageText(text: string): string {
  return maskIdentityNumbers(text).text;
}

/** Whether the thread's number has opted out of WhatsApp now (`app.whatsapp_thread_opted_out()`). */
export async function threadOptedOut(ctx: CommandContext, threadId: string): Promise<boolean> {
  const rows = (await ctx.tx.execute(
    sql`select app.whatsapp_thread_opted_out(${threadId}::uuid) as opted_out`,
  )) as unknown as { opted_out: boolean }[];
  return rows[0]?.opted_out === true;
}

/** The thread as the screens show it. */
export function toThreadDto(row: ThreadRow, optedOut: boolean): WhatsAppThreadDto {
  return WhatsAppThreadDto.parse({
    id: row.id,
    entityId: row.entityId,
    number: `+${row.waId}`,
    accountId: row.accountId,
    opportunityId: row.opportunityId,
    assigneeId: row.assigneeId,
    windowOpenUntil: row.windowOpenUntil?.toISOString() ?? null,
    optedOut,
    handledBy: WhatsAppThreadHandlerSchema.parse(row.handledBy),
    handoffReason:
      row.handoffReason === null ? null : WhatsAppHandoffReasonSchema.parse(row.handoffReason),
    handedOffAt: row.handedOffAt?.toISOString() ?? null,
    lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
    needsReply: row.needsReply,
  });
}

/**
 * A thread the caller reads in the company of the request, locked for this transaction when it is
 * to change. One the caller cannot read (the customer's read rule), of another company, or that
 * does not exist is not found.
 */
export async function readThread(
  ctx: CommandContext,
  input: { entityId: number; threadId: string },
  lock: boolean,
): Promise<ThreadRow> {
  const t = schema.whatsappThreads;
  const query = ctx.tx
    .select()
    .from(t)
    .where(and(eq(t.id, input.threadId), eq(t.entityId, input.entityId)))
    .limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) {
    throw new DomainError('not_found', `thread ${input.threadId} is not visible`, {
      reason: 'whatsapp_thread_missing',
    });
  }
  return row;
}

/** What the audit row shows of who answers a thread. */
export function auditedHandler(row: Pick<ThreadRow, 'handledBy' | 'handoffReason'>) {
  return { handledBy: row.handledBy, handoffReason: row.handoffReason };
}

/** The platform's definers answer timestamps as text or dates, by the driver's reading. */
export function isoOf(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
