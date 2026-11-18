import { schema } from '@shakti/db';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { threadOptedOut } from '../commands/messaging/shared';

/**
 * Why a quote cannot go by WhatsApp now (docs/03-roadmap-appendix/phase2.md §7.1), each an
 * `errors.*` reason: the customer has no chat with the company's number, the number opted out, no
 * holder of the number among the customer's contacts gave WhatsApp consent, or the company maps no
 * approved template to the `quote_sent` milestone.
 */
export type QuoteWhatsAppRefusal =
  | 'whatsapp_quote_no_chat'
  | 'whatsapp_opted_out'
  | 'whatsapp_quote_no_consent'
  | 'whatsapp_quote_template_missing';

export type QuoteWhatsAppReadiness =
  { ready: true; threadId: string } | { ready: false; reason: QuoteWhatsAppRefusal };

/**
 * Whether a quote of the customer `accountId` in company `entityId` can go by WhatsApp, read as the
 * caller: the customer's chat in the company with the latest message from them (a chat the caller
 * reads under the customer's read rule, with a number), its opt-out, a WhatsApp consent of a
 * holder of its number among the customer's contacts, and the company's approved `quote_sent`
 * template. The platform checks each again when it queues the message
 * (`app.whatsapp_queue_milestone()`).
 */
export async function quoteWhatsAppReadiness(
  ctx: Pick<CommandContext, 'tx'>,
  entityId: number,
  accountId: string,
): Promise<QuoteWhatsAppReadiness> {
  const t = schema.whatsappThreads;
  const [thread] = await ctx.tx
    .select({ id: t.id, waId: t.waId })
    .from(t)
    .where(and(eq(t.entityId, entityId), eq(t.accountId, accountId), isNotNull(t.waId)))
    .orderBy(sql`${t.lastInboundAt} desc nulls last`, desc(t.id))
    .limit(1);
  if (!thread?.waId) return { ready: false, reason: 'whatsapp_quote_no_chat' };
  if (await threadOptedOut(ctx, thread.id)) {
    return { ready: false, reason: 'whatsapp_opted_out' };
  }
  const cp = schema.contactPhones;
  const ac = schema.accountContacts;
  const c = schema.consents;
  const [consent] = await ctx.tx
    .select({ id: c.id })
    .from(cp)
    .innerJoin(ac, eq(ac.contactId, cp.contactId))
    .innerJoin(c, eq(c.contactId, cp.contactId))
    .where(
      and(
        eq(cp.e164, `+${thread.waId}`),
        eq(ac.accountId, accountId),
        eq(c.channel, 'whatsapp'),
        isNull(c.withdrawnAt),
      ),
    )
    .limit(1);
  if (!consent) return { ready: false, reason: 'whatsapp_quote_no_consent' };
  const m = schema.whatsappMilestones;
  const w = schema.whatsappTemplates;
  const [template] = await ctx.tx
    .select({ id: w.id })
    .from(m)
    .innerJoin(w, and(eq(w.id, m.templateId), eq(w.entityId, m.entityId)))
    .where(
      and(
        eq(m.entityId, entityId),
        eq(m.milestone, 'quote_sent'),
        eq(m.isActive, true),
        eq(w.status, 'approved'),
      ),
    )
    .limit(1);
  if (!template) return { ready: false, reason: 'whatsapp_quote_template_missing' };
  return { ready: true, threadId: thread.id };
}

/**
 * Whether the caller's quote could go by WhatsApp now, for the quote page's send dialog: the
 * quote as the caller reads it, then `quoteWhatsAppReadiness()` for its customer. Null when the
 * caller cannot read the quote. The send itself checks it all again.
 */
export async function readQuoteWhatsAppReadiness(
  ctx: Pick<CommandContext, 'tx'>,
  input: { entityId: number; quoteId: string },
): Promise<{ ready: boolean; reason: QuoteWhatsAppRefusal | null } | null> {
  const q = schema.quotes;
  const [quote] = await ctx.tx
    .select({ accountId: q.accountId })
    .from(q)
    .where(and(eq(q.id, input.quoteId), eq(q.entityId, input.entityId)))
    .limit(1);
  if (!quote) return null;
  const readiness = await quoteWhatsAppReadiness(ctx, input.entityId, quote.accountId);
  return readiness.ready
    ? { ready: true, reason: null }
    : { ready: false, reason: readiness.reason };
}
