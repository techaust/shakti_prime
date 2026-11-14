import {
  DomainError,
  type MessagingSendJob,
  type MessagingSendResult,
  type Principal,
} from '@shakti/contracts';
import {
  claimWhatsAppMessage,
  countConversation,
  decideSend,
  DEFAULT_SEND_RULES,
  executeCommand,
  executeQuery,
  readBudget,
  readSendFacts,
  recordWhatsAppSend,
  type KeyValue,
  type Logger,
} from '@shakti/domain';
import { ProviderError } from '../../integrations/http';
import type { WhatsAppClient } from '../../integrations/whatsapp/client';
import { logger as appLogger } from '../../log';

export interface SendDeps {
  /** `system:workers` scoped to the job's company. */
  principal: Principal;
  keyValue: KeyValue;
  requestId: string;
  now: () => Date;
  /** The send client of a company's number; undefined while no access key is set. */
  client: (phoneNumberId: string) => WhatsAppClient | undefined;
  hosted: boolean;
  logger?: Logger;
}

type Outcome = Exclude<MessagingSendResult, { outcome: 'duplicate' }>;

/**
 * Checks and sends one queued WhatsApp message (docs/06-api.md §6, design phase2 §6.1) as
 * `system:workers` of its company: the facts through `app.whatsapp_send_facts()`, the portfolio's
 * budget from the key-value store, then `decideSend` in the design's order. A refusal is recorded
 * on the message (`messaging.message.record_send`) and is final; a thread over its rate limit
 * throws `rate_limited`, so the queue delivers the message again later; a marketing template over
 * the hold share stays queued (`held`). A message that may go is taken once
 * (`messaging.message.claim`) and handed to Meta once: a timeout or an error from Meta records it
 * `failed` and it is never sent again, since a timeout does not prove Meta did not deliver it.
 * Logs carry ids and codes, never the text or the number.
 */
export async function sendQueuedMessage(
  job: MessagingSendJob,
  deps: SendDeps,
): Promise<Outcome> {
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
  const budget = await readBudget(deps.keyValue, facts.waId, now);
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
    return { eventId: job.eventId, outcome: 'done', status: 'refused', refusal: decision.refusal };
  }
  if (decision.kind === 'wait') {
    if (decision.reason === 'rate_limited') {
      throw new DomainError('rate_limited', `thread ${facts.threadId} is over its hourly limit`);
    }
    log.log('info', 'messaging.send_held', { requestId: deps.requestId, messageId: job.messageId });
    return done('held');
  }

  const client = facts.phoneNumberId === null ? undefined : deps.client(facts.phoneNumberId);
  if (client === undefined) {
    throw new DomainError('integration_unavailable', 'WhatsApp is not set up here', {
      reason: 'whatsapp_unavailable',
    });
  }
  const claimed = await executeCommand(deps.principal, scope, claimWhatsAppMessage, {
    entityId: job.entityId,
    messageId: job.messageId,
  });
  if (!claimed.claimed) return done('skipped');
  try {
    const sent =
      facts.kind === 'text'
        ? await client.sendText({ to: facts.waId, body: facts.body ?? '' })
        : await client.sendTemplate({
            to: facts.waId,
            templateName: facts.templateName ?? '',
            languageCode: 'en',
            bodyParameters: facts.templateParams,
          });
    await record({ status: 'sent', providerMessageId: sent.messageId });
    if (decision.businessInitiated) await countConversation(deps.keyValue, facts.waId, now);
    return {
      eventId: job.eventId,
      outcome: 'done',
      status: 'sent',
      providerMessageId: sent.messageId,
    };
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
}
