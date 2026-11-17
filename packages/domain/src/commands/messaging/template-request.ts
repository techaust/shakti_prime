import {
  DomainError,
  RequestTemplateInput,
  WhatsAppMessageDto,
  type ConsentPurpose,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { isAgent } from '../../command/run-command';
import { lockOpportunity, requireEntity } from '../crm/opportunity-shared';
import { sendWhatsAppMessage } from './send-message';

/** The WhatsApp consents in force that a template of each category needs, any one of them. */
const CONSENT_FOR: Readonly<Record<'utility' | 'marketing', readonly ConsentPurpose[]>> = {
  utility: ['service', 'promotional'],
  marketing: ['promotional'],
};

/**
 * `messaging.template.request` (docs/03-roadmap-appendix/phase2.md §7.3, CALL-5): a WhatsApp
 * template for a lead's customer, on its occasion: a nurture message while the lead is in
 * nurture, or a nudge about a sent quote of the lead that has not expired. The Caller Co-pilot
 * proposes it (`crm.lead.write`, its own grant), and nothing is sent until a person approves it:
 * approving runs this command as the person, who then queues the template through
 * `messaging.message.send` under their own `messaging.send`. An agent running it itself, the
 * Co-pilot included, is refused (`people_only`): it is not marked for people only, since the
 * action type must name a command the Co-pilot may propose, but its handler queues nothing for an
 * agent.
 *
 * Checked in the transaction, whatever the proposal said: the lead is the caller's to write; the
 * customer has a WhatsApp chat with the company; the template is the company's, approved, a
 * utility or marketing template the platform does not send for a purpose of its own, with no
 * blanks, so the person approves exactly the words that are sent; and the chat's person holds a
 * WhatsApp consent in force (a promotional one for a marketing template). The messaging command
 * then refuses a number that opted out and checks the template again.
 */
export const requestTemplate = defineCommand({
  name: 'messaging.template.request',
  permission: 'crm.lead.write',
  minScope: 'own',
  input: RequestTemplateInput,
  output: WhatsAppMessageDto,
  auditFields: ['occasion', 'templateName'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    // Only a person queues a WhatsApp message: the Co-pilot proposes this, never runs it.
    if (isAgent(ctx.principal)) {
      throw new DomainError('forbidden', `${ctx.principal.roleKey} does not queue messages`, {
        reason: 'people_only',
      });
    }
    // The lead, under the caller's write scope (the lock takes the update policy).
    const lead = await lockOpportunity(ctx, input);

    if (input.occasion === 'nurture' && lead.state !== 'nurture') {
      throw new DomainError('conflict', `lead ${lead.id} is not in nurture`, {
        reason: 'copilot_lead_not_in_nurture',
      });
    }
    if (input.occasion === 'quote_expiry') {
      const q = schema.quotes;
      const [quote] = await ctx.tx
        .select({ state: q.state, validUntil: q.validUntil })
        .from(q)
        .where(
          and(
            eq(q.id, input.quoteId ?? ''),
            eq(q.opportunityId, lead.id),
            eq(q.entityId, lead.entityId),
          ),
        )
        .limit(1);
      if (quote === undefined) {
        throw new DomainError('not_found', `quote ${input.quoteId ?? ''} is not of this lead`, {
          reason: 'quote_missing',
        });
      }
      if (quote.state !== 'sent' || quote.validUntil <= ctx.now) {
        throw new DomainError('conflict', `quote ${input.quoteId ?? ''} is no longer open`, {
          reason: 'copilot_quote_not_open',
        });
      }
    }

    // The customer's newest chat with the company that still has a number.
    const t = schema.whatsappThreads;
    const [thread] = await ctx.tx
      .select({ id: t.id, contactPhoneId: t.contactPhoneId })
      .from(t)
      .where(and(eq(t.entityId, lead.entityId), eq(t.accountId, lead.accountId), isNotNull(t.waId)))
      .orderBy(sql`${t.lastInboundAt} desc nulls last`, desc(t.id))
      .limit(1);
    if (thread === undefined) {
      throw new DomainError('not_found', `lead ${lead.id} has no WhatsApp chat`, {
        reason: 'whatsapp_thread_missing',
      });
    }

    const w = schema.whatsappTemplates;
    const [template] = await ctx.tx
      .select({ category: w.category, status: w.status, purpose: w.purpose, params: w.params })
      .from(w)
      .where(
        and(eq(w.entityId, lead.entityId), eq(w.name, input.templateName), eq(w.language, 'en')),
      )
      .limit(1);
    if (template === undefined) {
      throw new DomainError('not_found', `template ${input.templateName} is not registered`, {
        reason: 'whatsapp_template_missing',
      });
    }
    const blanks = Array.isArray(template.params) ? template.params.length : 0;
    const category =
      template.category === 'utility' || template.category === 'marketing'
        ? template.category
        : undefined;
    if (template.purpose !== null || blanks !== 0 || category === undefined) {
      throw new DomainError('conflict', `template ${input.templateName} cannot be proposed`, {
        reason: 'copilot_template_not_allowed',
      });
    }
    if (template.status !== 'approved') {
      throw new DomainError('conflict', `template ${input.templateName} is not approved`, {
        reason: 'whatsapp_template_not_approved',
      });
    }

    // The chat's person holds a WhatsApp consent in force for the template's kind.
    const needed = CONSENT_FOR[category];
    const cp = schema.contactPhones;
    const c = schema.consents;
    const [consent] =
      thread.contactPhoneId === null
        ? []
        : await ctx.tx
            .select({ id: c.id })
            .from(c)
            .innerJoin(cp, eq(cp.contactId, c.contactId))
            .where(
              and(
                eq(cp.id, thread.contactPhoneId),
                eq(c.channel, 'whatsapp'),
                inArray(c.purpose, [...needed]),
                isNull(c.withdrawnAt),
                lte(c.givenAt, ctx.now),
              ),
            )
            .limit(1);
    if (consent === undefined) {
      throw new DomainError('conflict', `the customer of lead ${lead.id} holds no consent`, {
        reason: 'whatsapp_consent_missing',
      });
    }

    const message = await ctx.run(sendWhatsAppMessage, {
      entityId: lead.entityId,
      threadId: thread.id,
      kind: 'template',
      templateName: input.templateName,
      params: [],
    });
    ctx.audit({
      aggregateType: 'opportunity',
      aggregateId: lead.id,
      entityId: lead.entityId,
      after: { occasion: input.occasion, templateName: input.templateName },
    });
    return message;
  },
});
