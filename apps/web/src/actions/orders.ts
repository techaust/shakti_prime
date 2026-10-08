'use server';

import {
  AcceptQuoteInput,
  CreateSalesOrderInput,
  DealerCreditHistoryInput,
  ListDealerCreditInput,
  ListSalesOrdersInput,
  RecordDealerOutstandingInput,
  SalesOrderBuilderInput,
  SalesOrderReasonInput,
  SalesOrderRefInput,
  SetDealerTermsInput,
  type ConfirmSalesOrderDto,
  type DealerCreditHistoryDto,
  type DealerCreditPageDto,
  type DealerOutstandingDto,
  type DealerTermsDto,
  type QuoteDto,
  type SalesOrderBuilderDto,
  type SalesOrderDto,
  type SalesOrderPageDto,
  type SalesOrderPreviewDto,
} from '@shakti/contracts';
import {
  acceptQuote as acceptQuoteCommand,
  cancelSalesOrder as cancelSalesOrderCommand,
  confirmSalesOrder as confirmSalesOrderCommand,
  createSalesOrder as createSalesOrderCommand,
  dealerCreditHistory as dealerCreditHistoryQuery,
  executeCommand,
  executeQuery,
  getSalesOrder as getSalesOrderQuery,
  listDealerCredit as listDealerCreditQuery,
  listSalesOrders as listSalesOrdersQuery,
  loadSalesOrderBuilder as loadSalesOrderBuilderQuery,
  previewSalesOrder as previewSalesOrderQuery,
  recordDealerOutstanding as recordDealerOutstandingCommand,
  releaseCredit as releaseCreditCommand,
  setDealerTerms as setDealerTermsCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

/** An order or dealer credit command, in a request narrowed to its company. */
async function companyCommand<T>(
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

/** Records the customer's signed copy, which accepts the quote and makes its order. */
export async function acceptQuote(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<QuoteDto>> {
  return companyCommand(
    'acceptQuote',
    AcceptQuoteInput,
    acceptQuoteCommand,
    rawInput,
    idempotencyKey,
  );
}

/** What the dealer's order form opens with (docs/03-roadmap-appendix/phase1.md §8.3). */
export async function loadOrderBuilder(
  rawInput: unknown,
): Promise<ActionResult<SalesOrderBuilderDto>> {
  return toResult('loadOrderBuilder', async () => {
    const principal = await signedIn();
    const input = parseInput(SalesOrderBuilderInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => loadSalesOrderBuilderQuery(context, input),
      { name: 'loadOrderBuilder' },
    );
  });
}

/** The dealer's order the lines would make today, worked out on the server and not saved. */
export async function previewOrder(rawInput: unknown): Promise<ActionResult<SalesOrderPreviewDto>> {
  return toResult('previewOrder', async () => {
    const principal = await signedIn();
    const input = parseInput(CreateSalesOrderInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => previewSalesOrderQuery(context, input),
      { name: 'previewOrder' },
    );
  });
}

/** Makes a dealer's order without a quote (`sales.order.create`). */
export async function createOrder(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<SalesOrderDto>> {
  return companyCommand(
    'createOrder',
    CreateSalesOrderInput,
    createSalesOrderCommand,
    rawInput,
    idempotencyKey,
  );
}

/** One order with its lines, for the order page. */
export async function getOrder(rawInput: unknown): Promise<ActionResult<SalesOrderDto>> {
  return toResult('getOrder', async () => {
    const principal = await signedIn();
    const input = parseInput(SalesOrderRefInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => getSalesOrderQuery(context, input),
      { name: 'getOrder' },
    );
  });
}

/** A page of `/orders`, newest first, in the companies being viewed. */
export async function listOrders(rawInput: unknown): Promise<ActionResult<SalesOrderPageDto>> {
  return toResult('listOrders', async () => {
    const principal = await signedIn();
    const input = parseInput(ListSalesOrdersInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      input.entityId === undefined ? { requestId } : { entityIds: [input.entityId], requestId },
      (context) => listSalesOrdersQuery(context, input),
      { name: 'listOrders' },
    );
  });
}

/** Confirms an order after the dealer credit check; a block holds it instead. */
export async function confirmOrder(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ConfirmSalesOrderDto>> {
  return companyCommand(
    'confirmOrder',
    SalesOrderRefInput,
    confirmSalesOrderCommand,
    rawInput,
    idempotencyKey,
  );
}

/** The Executive releases an order's credit hold, with the reason. */
export async function releaseOrderCredit(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<SalesOrderDto>> {
  return companyCommand(
    'releaseOrderCredit',
    SalesOrderReasonInput,
    releaseCreditCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Cancels an order, with the reason. */
export async function cancelOrder(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<SalesOrderDto>> {
  return companyCommand(
    'cancelOrder',
    SalesOrderReasonInput,
    cancelSalesOrderCommand,
    rawInput,
    idempotencyKey,
  );
}

/** A page of `/dealer-credit` for one company. */
export async function listDealerCredit(
  rawInput: unknown,
): Promise<ActionResult<DealerCreditPageDto>> {
  return toResult('listDealerCredit', async () => {
    const principal = await signedIn();
    const input = parseInput(ListDealerCreditInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listDealerCreditQuery(context, input),
      { name: 'listDealerCredit' },
    );
  });
}

/** One dealer's terms and outstanding entries in one company, newest first. */
export async function dealerCreditHistory(
  rawInput: unknown,
): Promise<ActionResult<DealerCreditHistoryDto>> {
  return toResult('dealerCreditHistory', async () => {
    const principal = await signedIn();
    const input = parseInput(DealerCreditHistoryInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => dealerCreditHistoryQuery(context, input),
      { name: 'dealerCreditHistory' },
    );
  });
}

/** Accounts enter a dealer's credit limit and days. */
export async function setDealerTerms(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DealerTermsDto>> {
  return companyCommand(
    'setDealerTerms',
    SetDealerTermsInput,
    setDealerTermsCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Accounts enter a dealer's outstanding as of a date. */
export async function recordDealerOutstanding(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DealerOutstandingDto>> {
  return companyCommand(
    'recordDealerOutstanding',
    RecordDealerOutstandingInput,
    recordDealerOutstandingCommand,
    rawInput,
    idempotencyKey,
  );
}
