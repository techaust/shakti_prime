import {
  DomainError,
  type MessagingSendJob,
  type MessagingSendResult,
  type Principal,
} from '@shakti/contracts';
import {
  acceptanceCode,
  claimWhatsAppMessage,
  noteConversation,
  decideSend,
  DEFAULT_SEND_RULES,
  executeCommand,
  executeQuery,
  budgetFor,
  notifyEvent,
  quoteButtonTokens,
  readSendExtras,
  readSendFacts,
  recordWhatsAppSend,
  type FileStore,
  type KeyValue,
  type Logger,
  type SendExtras,
  type SendFactsRow,
} from '@shakti/domain';
import { ProviderError } from '../../integrations/http';
import type { TemplateMessage, WhatsAppClient } from '../../integrations/whatsapp/client';
import { logger as appLogger } from '../../log';
import { deliverNoticeBatch } from '../notify/deliver-notices';

export interface SendDeps {
  /** `system:workers` scoped to the job's company. */
  principal: Principal;
  keyValue: KeyValue;
  requestId: string;
  now: () => Date;
  /** The send client of a company's number; undefined while no access key is set. */
  client: (phoneNumberId: string) => WhatsAppClient | undefined;
  hosted: boolean;
  /** `WHATSAPP_BUTTON_SECRET`: a quote's button payloads and a one-time code are made with it. */
  buttonSecret: string | undefined;
  /** Where a quote's PDF is read from, for the address Meta fetches it at; undefined if none. */
  store: FileStore | undefined;
  logger?: Logger;
}

/** What a template's message carries beyond its stored values. */
type TemplateParts = Pick<TemplateMessage, 'bodyParameters' | 'headerDocument' | 'buttons'>;

const unavailable = (what: string) =>
  new DomainError('integration_unavailable', `${what} is not set up here`, {
    reason: 'whatsapp_unavailable',
  });

/**
 * A template's values as it goes out (docs/03-roadmap-appendix/phase2.md §7.1): the stored ones,
 * and, made only now so that none is ever stored, the one-time code of an `acceptance_code`
 * message (from the message's id, in its body and its copy-code button) and the Accept and Talk to
 * us payloads of a quote's `quote_sent` milestone (bound to the quote, the chat and the number),
 * with the quote's PDF as the header document. Without the secret, or a store for the PDF, the
 * message waits (`integration_unavailable`), since it cannot go as it should.
 */
async function templateParts(
  facts: SendFactsRow,
  extras: SendExtras | null,
  deps: SendDeps,
): Promise<TemplateParts> {
  const secret = deps.buttonSecret ?? '';
  if (extras?.templatePurpose === 'acceptance_code') {
    if (secret === '') throw unavailable('the WhatsApp button secret');
    const code = acceptanceCode(secret, facts.messageId);
    return { bodyParameters: [code], buttons: [{ index: 0, kind: 'url', value: code }] };
  }
  const milestone = extras?.milestone;
  if (milestone?.name !== 'quote_sent' || milestone.subjectKind !== 'quote') {
    return { bodyParameters: facts.templateParams };
  }
  if (secret === '') throw unavailable('the WhatsApp button secret');
  const [accept, talk] = quoteButtonTokens(secret, milestone.subjectId, {
    threadId: facts.threadId,
    waId: facts.waId,
  });
  const parts: TemplateParts = {
    bodyParameters: facts.templateParams,
    buttons: [
      { index: 0, kind: 'quick_reply', value: accept ?? '' },
      { index: 1, kind: 'quick_reply', value: talk ?? '' },
    ],
  };
  const file = extras?.file;
  if (file?.status !== 'ready') return parts;
  if (deps.store === undefined) throw unavailable('a file store');
  const filename = file.name === '' ? 'quote.pdf' : file.name;
  const signed = await deps.store.presignGet(file.key, { filename, disposition: 'inline' });
  return { ...parts, headerDocument: { link: signed.url, filename } };
}

type Outcome = Exclude<MessagingSendResult, { outcome: 'duplicate' }>;

/**
 * A quote's `quote_sent` message refused after the quote was marked sent (the window, the
 * template, the number's STOP, the messaging limit, the filter): the person who sent the quote is
 * told through the notice a milestone that was never queued brings (`whatsapp_quote_not_sent`,
 * once a quote), so they share it another way. Any other message, or a milestone no person asked
 * for, tells no one. Run after the refusal is recorded; a failure here is logged and the refusal
 * stands, since a delivery again would find the message refused and skip it.
 */
async function tellQuoteSender(job: MessagingSendJob, deps: SendDeps, log: Logger): Promise<void> {
  const scope = { entityIds: [job.entityId], requestId: deps.requestId };
  try {
    const extras = await executeQuery(
      deps.principal,
      scope,
      (ctx) => readSendExtras(ctx, job.messageId),
      { name: 'messaging.send.extras' },
    );
    const milestone = extras?.milestone;
    if (
      milestone?.name !== 'quote_sent' ||
      milestone.subjectKind !== 'quote' ||
      milestone.requestedBy === null
    ) {
      return;
    }
    const batch = await executeCommand(deps.principal, scope, notifyEvent, {
      event: 'sales.quote.sent',
      entityId: job.entityId,
      eventId: job.eventId,
      quoteId: milestone.subjectId,
      sentBy: milestone.requestedBy,
    });
    await deliverNoticeBatch(deps.principal, batch, { requestId: deps.requestId });
  } catch (error) {
    log.log('error', 'messaging.quote_refusal_notice_failed', {
      requestId: deps.requestId,
      messageId: job.messageId,
      error,
    });
  }
}

/**
 * Checks and sends one queued WhatsApp message (docs/06-api.md §6, design phase2 §6.1) as
 * `system:workers` of its company: the facts through `app.whatsapp_send_facts()`, the portfolio's
 * budget from the key-value store, then `decideSend` in the design's order. A refusal is recorded
 * on the message (`messaging.message.record_send`) and is final; a thread over its rate limit
 * throws `rate_limited`, so the queue delivers the message again later; a marketing template over
 * the hold share stays queued (`held`). A message that may go is taken once
 * (`messaging.message.claim`) and handed to Meta once: a timeout or an error from Meta records it
 * `failed` and it is never sent again, since a timeout does not prove Meta did not deliver it. The
 * claim checks the opt-out again, so a STOP recorded meanwhile is still a refusal.
 * Logs carry ids and codes, never the text or the number.
 */
export async function sendQueuedMessage(job: MessagingSendJob, deps: SendDeps): Promise<Outcome> {
  const log = deps.logger ?? appLogger;
  const scope = { entityIds: [job.entityId], requestId: deps.requestId };
  const done = (status: 'failed' | 'held' | 'skipped'): Outcome => ({
    eventId: job.eventId,
    outcome: 'done',
    status,
  });
  const facts = await executeQuery(
    deps.principal,
    scope,
    (ctx) => readSendFacts(ctx, job.messageId),
    { name: 'messaging.send.facts' },
  );
  if (facts === null) return done('skipped');
  const now = deps.now();
  const budget = await budgetFor(deps.keyValue, facts.waId, now);
  const decision = decideSend(facts, budget, now, {
    ...DEFAULT_SEND_RULES,
    companyNumbers: facts.companyNumbers,
  });
  const record = (input: Record<string, unknown>) =>
    executeCommand(deps.principal, scope, recordWhatsAppSend, {
      entityId: job.entityId,
      messageId: job.messageId,
      ...input,
    });

  if (decision.kind === 'skip') return done('skipped');
  if (decision.kind === 'refuse') {
    await record({ status: 'refused', refusal: decision.refusal });
    log.log('info', 'messaging.send_refused', {
      requestId: deps.requestId,
      messageId: job.messageId,
      refusal: decision.refusal,
    });
    if (facts.kind === 'template') await tellQuoteSender(job, deps, log);
    return { eventId: job.eventId, outcome: 'done', status: 'refused', refusal: decision.refusal };
  }
  if (decision.kind === 'wait') {
    if (decision.until === 'rate_limited') {
      throw new DomainError('rate_limited', `thread ${facts.threadId} is over its hourly limit`);
    }
    log.log('info', 'messaging.send_held', { requestId: deps.requestId, messageId: job.messageId });
    return done('held');
  }

  const client = facts.phoneNumberId === null ? undefined : deps.client(facts.phoneNumberId);
  if (client === undefined) throw unavailable('WhatsApp');
  // Made before the message is taken, so a message that cannot go as it should waits instead.
  const parts =
    facts.kind === 'text'
      ? undefined
      : await templateParts(
          facts,
          await executeQuery(deps.principal, scope, (ctx) => readSendExtras(ctx, job.messageId), {
            name: 'messaging.send.extras',
          }),
          deps,
        );
  const claimed = await executeCommand(deps.principal, scope, claimWhatsAppMessage, {
    entityId: job.entityId,
    messageId: job.messageId,
  });
  if (!claimed.claimed) {
    // Not taken: another delivery took it, or the number opted out after the facts were read
    // (the claim checks the opt-out again), which is recorded as the refusal it is.
    const again = await executeQuery(
      deps.principal,
      scope,
      (ctx) => readSendFacts(ctx, job.messageId),
      { name: 'messaging.send.facts' },
    );
    if (
      again !== null &&
      again.status === 'queued' &&
      !again.sendAttempted &&
      again.optedOut &&
      !again.confirmation
    ) {
      await record({ status: 'refused', refusal: 'opted_out' });
      if (again.kind === 'template') await tellQuoteSender(job, deps, log);
      return { eventId: job.eventId, outcome: 'done', status: 'refused', refusal: 'opted_out' };
    }
    return done('skipped');
  }
  let sent: { messageId: string };
  try {
    sent =
      facts.kind === 'text'
        ? await client.sendText({ to: facts.waId, body: facts.body ?? '' })
        : await client.sendTemplate({
            to: facts.waId,
            templateName: facts.templateName ?? '',
            languageCode: 'en',
            bodyParameters: facts.templateParams,
            ...parts,
          });
  } catch (error) {
    const vendor = error instanceof ProviderError ? error.vendorCode : undefined;
    const code = vendor === undefined ? Number.NaN : Number(vendor.split('/')[0]);
    await record({ status: 'failed', errorCode: Number.isInteger(code) ? code : null });
    log.log('warn', 'messaging.send_failed', {
      requestId: deps.requestId,
      messageId: job.messageId,
      failure: error instanceof ProviderError ? error.failure : 'unknown',
    });
    return done('failed');
  }
  // Recorded outside the send's catch: Meta accepted the message, so a failure here is never
  // recorded as not delivered. If it throws, the message keeps its claim and is never sent again;
  // the chat shows it as not delivered once the worker's time is past (`threadMessagesSql`).
  await record({ status: 'sent', providerMessageId: sent.messageId });
  if (decision.businessInitiated) await noteConversation(deps.keyValue, facts.waId, now);
  return {
    eventId: job.eventId,
    outcome: 'done',
    status: 'sent',
    providerMessageId: sent.messageId,
  };
}
