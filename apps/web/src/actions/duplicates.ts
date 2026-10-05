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
  previewCustomerMerge as previewCustomerMergeQuery,
  unmergeCustomers as unmergeCustomersCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/**
 * Duplicates (CRM-03, docs/design/phase1.md §7.4): thin wrappers (docs/API.md §4). Each command
 * runs with the request narrowed to the company whose screen it is made from.
 */

/** `/duplicates`: the open cards the caller sees, surest first; the next page after `cursor`. */
export async function listDuplicates(rawInput: unknown): Promise<ActionResult<DuplicatePageDto>> {
  return toResult('listDuplicates', async () => {
    const principal = await signedIn();
    const input = parseInput(ListDuplicatesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listDuplicatesQuery(context, input), {
      name: 'listDuplicates',
    });
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
      { entityIds: [input.entityId], requestId },
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
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (context) => previewCustomerMergeQuery(context, input),
      { name: 'previewCustomerMerge' },
    );
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
      { entityIds: [input.entityId], requestId: meta.requestId },
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
      { entityIds: [input.entityId], requestId: meta.requestId },
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
      { entityIds: [input.entityId], requestId: meta.requestId },
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
      { entityIds: [input.entityId], requestId: meta.requestId },
      dismissDuplicateCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
