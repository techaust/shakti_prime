'use server';

import {
  DismissDuplicateInput,
  ListAccountDuplicatesInput,
  ListDuplicatesInput,
  MergeCustomersInput,
  MergeLeadsInput,
  PreviewCustomerMergeInput,
  UnmergeCustomersInput,
  type AccountDuplicatesDto,
  type CustomerMergeDto,
  type CustomerMergeMovedDto,
  type DuplicateCandidateDto,
  type DuplicatePageDto,
  type LeadMergeDto,
} from '@shakti/contracts';
import {
  dismissDuplicate as dismissDuplicateCommand,
  executeCommand,
  executeQuery,
  listAccountDuplicates as listAccountDuplicatesQuery,
  listDuplicates as listDuplicatesQuery,
  mergeCustomers as mergeCustomersCommand,
  mergeLeads as mergeLeadsCommand,
  countMergeMoves,
  unmergeCustomers as unmergeCustomersCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/**
 * Duplicates (CRM-03, docs/03-roadmap-appendix/phase1.md §7.4): thin wrappers (docs/06-api.md §4). Each read and
 * command runs with every company the caller works for, and names the card's company in its
 * input (`entityId`): a customer is shared between the companies (ADR 0008), and a merge, its undo
 * and a dismissal must see each relationship of both customers, which a request narrowed to one
 * company hides.
 */

/** `/duplicates`: the open cards the caller sees, surest first; the next page after `cursor`. */
export async function listDuplicates(rawInput: unknown): Promise<ActionResult<DuplicatePageDto>> {
  return toResult('listDuplicates', async () => {
    const principal = await signedIn();
    const input = parseInput(ListDuplicatesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listDuplicatesQuery(context, input),
      {
        name: 'listDuplicates',
      },
    );
  });
}

/** The duplicate cards of one customer in one company, for Account 360. */
export async function listAccountDuplicates(
  rawInput: unknown,
): Promise<ActionResult<AccountDuplicatesDto>> {
  return toResult('listAccountDuplicates', async () => {
    const principal = await signedIn();
    const input = parseInput(ListAccountDuplicatesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => listAccountDuplicatesQuery(context, input),
      { name: 'listAccountDuplicates' },
    );
  });
}

/** What a customer merge would move, for the merge dialog. */
export async function previewCustomerMerge(
  rawInput: unknown,
): Promise<ActionResult<CustomerMergeMovedDto>> {
  return toResult('previewCustomerMerge', async () => {
    const principal = await signedIn();
    const input = parseInput(PreviewCustomerMergeInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => countMergeMoves(context, input), {
      name: 'previewCustomerMerge',
    });
  });
}

export async function mergeCustomers(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerMergeDto>> {
  return toResult('mergeCustomers', async () => {
    const principal = await signedIn();
    const input = parseInput(MergeCustomersInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      mergeCustomersCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function unmergeCustomers(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<CustomerMergeDto>> {
  return toResult('unmergeCustomers', async () => {
    const principal = await signedIn();
    const input = parseInput(UnmergeCustomersInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      unmergeCustomersCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function mergeLeads(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeadMergeDto>> {
  return toResult('mergeLeads', async () => {
    const principal = await signedIn();
    const input = parseInput(MergeLeadsInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      mergeLeadsCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function dismissDuplicate(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DuplicateCandidateDto>> {
  return toResult('dismissDuplicate', async () => {
    const principal = await signedIn();
    const input = parseInput(DismissDuplicateInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      dismissDuplicateCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
