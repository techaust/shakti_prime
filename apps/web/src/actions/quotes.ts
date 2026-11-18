'use server';

import {
  CreateQuoteInput,
  DomainError,
  ListQuotesInput,
  QuoteBuilderInput,
  QuoteRefInput,
  RequoteInput,
  SendQuoteInput,
  SetAccountTierInput,
  WithdrawQuoteInput,
  type AccountTierDto,
  type PriceTierOptionDto,
  type QuoteBuilderDto,
  type QuoteDto,
  type QuotePageDto,
  type QuotePreviewDto,
} from '@shakti/contracts';
import {
  createQuote as createQuoteCommand,
  executeCommand,
  executeQuery,
  getQuote as getQuoteQuery,
  listPriceTierOptions,
  listQuotes as listQuotesQuery,
  loadQuoteBuilder as loadQuoteBuilderQuery,
  previewQuote as previewQuoteQuery,
  readQuoteWhatsAppReadiness,
  requoteQuote as requoteQuoteCommand,
  sendQuote as sendQuoteCommand,
  setAccountTier as setAccountTierCommand,
  withdrawQuote as withdrawQuoteCommand,
  type AnyCommand,
  type QuoteWhatsAppRefusal,
} from '@shakti/domain';
import { whatsappButtonSecret } from '../workers/messaging/button-secret';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

/** A quote command, in a request narrowed to the quote's company. */
async function quoteCommand<T>(
  action: string,
  schema: Schema<{ entityId: number }>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<T>> {
  return toResult(action, async () => {
    const principal = await signedIn();
    const input = parseInput(schema, rawInput);
    const meta = await requestMeta();
    return (await executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
  });
}

/** What the quote builder of one lead opens with (docs/03-roadmap-appendix/phase1.md §7.3). */
export async function loadQuoteBuilder(rawInput: unknown): Promise<ActionResult<QuoteBuilderDto>> {
  return toResult('loadQuoteBuilder', async () => {
    const principal = await signedIn();
    const input = parseInput(QuoteBuilderInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => loadQuoteBuilderQuery(context, input),
      { name: 'loadQuoteBuilder' },
    );
  });
}

/** The quote the lines would make today, worked out on the server and not saved. */
export async function previewQuote(rawInput: unknown): Promise<ActionResult<QuotePreviewDto>> {
  return toResult('previewQuote', async () => {
    const principal = await signedIn();
    const input = parseInput(CreateQuoteInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => previewQuoteQuery(context, input),
      { name: 'previewQuote' },
    );
  });
}

/** Makes the quote (`sales.quote.create`). */
export async function createQuote(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<QuoteDto>> {
  return quoteCommand(
    'createQuote',
    CreateQuoteInput,
    createQuoteCommand,
    rawInput,
    idempotencyKey,
  );
}

/** One quote with its lines, for the quote page. */
export async function getQuote(rawInput: unknown): Promise<ActionResult<QuoteDto>> {
  return toResult('getQuote', async () => {
    const principal = await signedIn();
    const input = parseInput(QuoteRefInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => getQuoteQuery(context, input),
      { name: 'getQuote' },
    );
  });
}

/** A page of `/quotes`, newest first, in the companies being viewed. */
export async function listQuotes(rawInput: unknown): Promise<ActionResult<QuotePageDto>> {
  return toResult('listQuotes', async () => {
    const principal = await signedIn();
    const input = parseInput(ListQuotesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      input.entityId === undefined ? { requestId } : { entityIds: [input.entityId], requestId },
      (context) => listQuotesQuery(context, input),
      { name: 'listQuotes' },
    );
  });
}

/** Marks a quote with its PDF as sent to the customer. */
export async function sendQuote(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<QuoteDto>> {
  return quoteCommand('sendQuote', SendQuoteInput, sendQuoteCommand, rawInput, idempotencyKey);
}

/**
 * Whether the quote can go by WhatsApp now (docs/03-roadmap-appendix/phase2.md §7.1), for the send
 * dialog: `ready`, or why not, in the words of its `errors.*` reason (`whatsapp_unavailable` while
 * no button secret is set here). The send checks it all again.
 */
export async function quoteSendOptions(
  rawInput: unknown,
): Promise<ActionResult<{ whatsapp: 'ready' | QuoteWhatsAppRefusal | 'whatsapp_unavailable' }>> {
  return toResult('quoteSendOptions', async () => {
    const principal = await signedIn();
    const input = parseInput(QuoteRefInput, rawInput);
    const { requestId } = await requestMeta();
    const readiness = await executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => readQuoteWhatsAppReadiness(context, input),
      { name: 'quoteSendOptions' },
    );
    if (readiness === null) {
      throw new DomainError('not_found', `quote ${input.quoteId} is not visible`, {
        reason: 'quote_missing',
      });
    }
    if (whatsappButtonSecret() === undefined) return { whatsapp: 'whatsapp_unavailable' };
    return { whatsapp: readiness.reason ?? 'ready' };
  });
}

/** A new quote at today's prices in place of this one. */
export async function requoteQuote(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<QuoteDto>> {
  return quoteCommand('requoteQuote', RequoteInput, requoteQuoteCommand, rawInput, idempotencyKey);
}

/** Withdraws a quote, with the reason. */
export async function withdrawQuote(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<QuoteDto>> {
  return quoteCommand(
    'withdrawQuote',
    WithdrawQuoteInput,
    withdrawQuoteCommand,
    rawInput,
    idempotencyKey,
  );
}

/** The price tiers an Executive may give a customer. */
export async function listTierOptions(): Promise<ActionResult<PriceTierOptionDto[]>> {
  return toResult('listTierOptions', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listPriceTierOptions(context), {
      name: 'listTierOptions',
    });
  });
}

/** Gives a customer the price tier its quotes are priced from (`crm.account.tier.set`). */
export async function setCustomerTier(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<AccountTierDto>> {
  return toResult('setCustomerTier', async () => {
    const principal = await signedIn();
    const input = parseInput(SetAccountTierInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      setAccountTierCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
