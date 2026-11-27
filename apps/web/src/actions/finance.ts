'use server';

import {
  CancelProformaInput,
  IssueProformaInput,
  OrderPaymentsInput,
  PaymentTermsInput,
  PlanMilestonesInput,
  PublishMilestoneTemplateInput,
  WaiveMilestoneInput,
  type MilestoneTemplateDto,
  type OrderPaymentsDto,
  type PaymentMilestoneDto,
  type PaymentTermsDto,
  type PlannedMilestonesDto,
  type ProformaDto,
} from '@shakti/contracts';
import {
  cancelProforma as cancelProformaCommand,
  executeCommand,
  executeQuery,
  issueProforma as issueProformaCommand,
  listPaymentTerms as listPaymentTermsQuery,
  planMilestonesByHand as planMilestonesCommand,
  publishPaymentTerms as publishPaymentTermsCommand,
  readOrderPayments as readOrderPaymentsQuery,
  waiveMilestone as waiveMilestoneCommand,
  type AnyCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn, type Schema } from './support';

// FN1 proformas and payment milestones (docs/03-roadmap-appendix/phase5.md §6.1): the order's
// Payments tab and Settings › Payment terms, each in a request narrowed to the record's company.

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

/** The order's Payments tab: its milestones, proformas, the dispatch's payment gate, and moves. */
export async function getOrderPayments(rawInput: unknown): Promise<ActionResult<OrderPaymentsDto>> {
  return toResult('getOrderPayments', async () => {
    const principal = await signedIn();
    const input = parseInput(OrderPaymentsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => readOrderPaymentsQuery(context, input),
      { name: 'getOrderPayments' },
    );
  });
}

export async function issueProforma(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProformaDto>> {
  return companyCommand(
    'issueProforma',
    IssueProformaInput,
    issueProformaCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function cancelProforma(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ProformaDto>> {
  return companyCommand(
    'cancelProforma',
    CancelProformaInput,
    cancelProformaCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function planMilestones(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PlannedMilestonesDto>> {
  return companyCommand(
    'planMilestones',
    PlanMilestonesInput,
    planMilestonesCommand,
    rawInput,
    idempotencyKey,
  );
}

export async function waiveMilestone(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<PaymentMilestoneDto>> {
  return companyCommand(
    'waiveMilestone',
    WaiveMilestoneInput,
    waiveMilestoneCommand,
    rawInput,
    idempotencyKey,
  );
}

/** Settings › Payment terms: one company's published versions, newest first per segment. */
export async function listPaymentTerms(rawInput: unknown): Promise<ActionResult<PaymentTermsDto>> {
  return toResult('listPaymentTerms', async () => {
    const principal = await signedIn();
    const input = parseInput(PaymentTermsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => listPaymentTermsQuery(context, input),
      { name: 'listPaymentTerms' },
    );
  });
}

export async function publishPaymentTerms(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<MilestoneTemplateDto>> {
  return companyCommand(
    'publishPaymentTerms',
    PublishMilestoneTemplateInput,
    publishPaymentTermsCommand,
    rawInput,
    idempotencyKey,
  );
}
