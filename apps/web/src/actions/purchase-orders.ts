'use server';

import {
  ApprovePurchaseOrderInput,
  CancelPurchaseOrderInput,
  ClosePurchaseOrderInput,
  CreatePurchaseOrderInput,
  PostGoodsReceiptInput,
  RemoveReorderRuleInput,
  ReverseGoodsReceiptInput,
  SendPurchaseOrderInput,
  SetReorderRuleInput,
  UpdatePurchaseOrderInput,
  type GoodsReceiptPageDto,
  type GoodsReceiptRefDto,
  type PurchaseOrderDto,
  type PurchaseOrderPageDto,
  type PurchaseOrderRefDto,
  type PurchaseOrderWithRatesDto,
  type ReceiveGoodsDto,
  type ReorderRuleDto,
  type ReorderRuleRowDto,
} from '@shakti/contracts';
import {
  approvePurchaseOrder as approveCommand,
  cancelPurchaseOrder as cancelCommand,
  closePurchaseOrder as closeCommand,
  createPurchaseOrder as createCommand,
  executeCommand,
  executeQuery,
  getPurchaseOrder as getPurchaseOrderQuery,
  getReceiveGoods as getReceiveGoodsQuery,
  listGoodsReceipts as listGoodsReceiptsQuery,
  listPurchaseOrders as listPurchaseOrdersQuery,
  listReorderRules as listReorderRulesQuery,
  postGoodsReceipt as postReceiptCommand,
  removeReorderRule as removeRuleCommand,
  reverseGoodsReceipt as reverseReceiptCommand,
  sendPurchaseOrder as sendCommand,
  setReorderRule as setRuleCommand,
  updatePurchaseOrder as updateCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// Thin wrappers (docs/06-api.md §4) for purchase orders, goods receipts and reorder rules
// (docs/03-roadmap-appendix/phase3.md §7.2): parse → request context → command or query → DTO.
// The commands answer references with no rate; the order sheet's rates come only from
// getPurchaseOrder, which reads them only for a holder of procurement.rate.read.

async function run<T>(
  name: string,
  schema: Schema<unknown>,
  command: AnyCommand,
  rawInput: unknown,
  idempotencyKey: unknown,
): Promise<ActionResult<T>> {
  return toResult(name, async () => {
    const principal = await signedIn();
    const input = parseInput(schema, rawInput);
    const meta = await requestMeta();
    return (await executeCommand(
      principal,
      { requestId: meta.requestId },
      command,
      input,
      commandOptions(meta, idempotencyKey),
    )) as T;
  });
}

export async function createPurchaseOrder(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PurchaseOrderRefDto>> {
  return run('createPurchaseOrder', CreatePurchaseOrderInput, createCommand, rawInput, idempotencyKey);
}

export async function updatePurchaseOrder(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PurchaseOrderRefDto>> {
  return run('updatePurchaseOrder', UpdatePurchaseOrderInput, updateCommand, rawInput, idempotencyKey);
}

export async function approvePurchaseOrder(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PurchaseOrderRefDto>> {
  return run('approvePurchaseOrder', ApprovePurchaseOrderInput, approveCommand, rawInput, idempotencyKey);
}

export async function sendPurchaseOrder(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PurchaseOrderRefDto>> {
  return run('sendPurchaseOrder', SendPurchaseOrderInput, sendCommand, rawInput, idempotencyKey);
}

export async function cancelPurchaseOrder(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PurchaseOrderRefDto>> {
  return run('cancelPurchaseOrder', CancelPurchaseOrderInput, cancelCommand, rawInput, idempotencyKey);
}

export async function closePurchaseOrder(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PurchaseOrderRefDto>> {
  return run('closePurchaseOrder', ClosePurchaseOrderInput, closeCommand, rawInput, idempotencyKey);
}

export async function postGoodsReceipt(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<GoodsReceiptRefDto>> {
  return run('postGoodsReceipt', PostGoodsReceiptInput, postReceiptCommand, rawInput, idempotencyKey);
}

export async function reverseGoodsReceipt(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<GoodsReceiptRefDto>> {
  return run(
    'reverseGoodsReceipt',
    ReverseGoodsReceiptInput,
    reverseReceiptCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function setReorderRule(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ReorderRuleDto>> {
  return run('setReorderRule', SetReorderRuleInput, setRuleCommand, rawInput, idempotencyKey);
}

export async function removeReorderRule(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ReorderRuleDto>> {
  return run('removeReorderRule', RemoveReorderRuleInput, removeRuleCommand, rawInput, idempotencyKey);
}

/** Procurement › Orders: a page of a company's orders in one state, with the reorder alerts. */
export async function listPurchaseOrders(
  rawInput: unknown,
): Promise<ActionResult<PurchaseOrderPageDto>> {
  return toResult('listPurchaseOrders', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (c) => listPurchaseOrdersQuery(c, rawInput), {
      name: 'listPurchaseOrders',
    });
  });
}

/** The order sheet; its rates and totals only for a holder of procurement.rate.read. */
export async function getPurchaseOrder(
  rawInput: unknown,
): Promise<ActionResult<PurchaseOrderDto | PurchaseOrderWithRatesDto>> {
  return toResult('getPurchaseOrder', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (c) => getPurchaseOrderQuery(c, rawInput), {
      name: 'getPurchaseOrder',
    });
  });
}

/** Receive goods: the order without values and the bins of its hub. */
export async function getReceiveGoods(rawInput: unknown): Promise<ActionResult<ReceiveGoodsDto>> {
  return toResult('getReceiveGoods', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (c) => getReceiveGoodsQuery(c, rawInput), {
      name: 'getReceiveGoods',
    });
  });
}

/** Procurement › Receipts: a page of a company's goods receipts. */
export async function listGoodsReceipts(
  rawInput: unknown,
): Promise<ActionResult<GoodsReceiptPageDto>> {
  return toResult('listGoodsReceipts', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (c) => listGoodsReceiptsQuery(c, rawInput), {
      name: 'listGoodsReceipts',
    });
  });
}

/** An item's reorder rules in a company, for its stock card. */
export async function listReorderRules(
  rawInput: unknown,
): Promise<ActionResult<ReorderRuleRowDto[]>> {
  return toResult('listReorderRules', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (c) => listReorderRulesQuery(c, rawInput), {
      name: 'listReorderRules',
    });
  });
}
