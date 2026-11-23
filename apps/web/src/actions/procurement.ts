'use server';

import {
  ArchiveVendorInput,
  CreateVendorInput,
  RecordVendorQuoteInput,
  SetItemVendorInput,
  SetVendorContactsInput,
  UpdateVendorInput,
  WithdrawVendorQuoteInput,
  type CompareQuotesDto,
  type ItemVendorSetDto,
  type VendorContactsDto,
  type VendorDto,
  type VendorListPageDto,
  type VendorQuoteDto,
  type VendorSheetDto,
  type VendorSheetWithQuotesDto,
} from '@shakti/contracts';
import {
  archiveVendor as archiveVendorCommand,
  compareQuotes as compareQuotesQuery,
  createVendor as createVendorCommand,
  executeCommand,
  executeQuery,
  getVendor as getVendorQuery,
  listVendors as listVendorsQuery,
  recordVendorQuote as recordVendorQuoteCommand,
  setItemVendor as setItemVendorCommand,
  setVendorContacts as setVendorContactsCommand,
  updateVendor as updateVendorCommand,
  withdrawVendorQuote as withdrawVendorQuoteCommand,
} from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

// Thin wrappers (docs/06-api.md §4): parse → request context → command or query → DTO. The vendor
// master is the group's (docs/03-roadmap-appendix/phase3.md §6.3); the commands check
// procurement.po.write, the quotes procurement.rate.read as well, and the queries check who may
// read the master and the rates before reading anything.

export async function createVendor(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<VendorDto>> {
  return toResult('createVendor', async () => {
    const principal = await signedIn();
    const input = parseInput(CreateVendorInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      createVendorCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function updateVendor(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<VendorDto>> {
  return toResult('updateVendor', async () => {
    const principal = await signedIn();
    const input = parseInput(UpdateVendorInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      updateVendorCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function archiveVendor(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<VendorDto>> {
  return toResult('archiveVendor', async () => {
    const principal = await signedIn();
    const input = parseInput(ArchiveVendorInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      archiveVendorCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function setVendorContacts(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<VendorContactsDto>> {
  return toResult('setVendorContacts', async () => {
    const principal = await signedIn();
    const input = parseInput(SetVendorContactsInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      setVendorContactsCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function setItemVendor(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<ItemVendorSetDto>> {
  return toResult('setItemVendor', async () => {
    const principal = await signedIn();
    const input = parseInput(SetItemVendorInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      setItemVendorCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function recordVendorQuote(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<VendorQuoteDto>> {
  return toResult('recordVendorQuote', async () => {
    const principal = await signedIn();
    const input = parseInput(RecordVendorQuoteInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      recordVendorQuoteCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

export async function withdrawVendorQuote(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<VendorQuoteDto>> {
  return toResult('withdrawVendorQuote', async () => {
    const principal = await signedIn();
    const input = parseInput(WithdrawVendorQuoteInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { requestId: meta.requestId },
      withdrawVendorQuoteCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Procurement › Vendors: a page of the vendor list, by name. */
export async function listVendors(rawInput: unknown): Promise<ActionResult<VendorListPageDto>> {
  return toResult('listVendors', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => listVendorsQuery(context, rawInput), {
      name: 'listVendors',
    });
  });
}

/** The vendor sheet; its quotes only for a holder of procurement.rate.read. */
export async function getVendor(
  rawInput: unknown,
): Promise<ActionResult<VendorSheetDto | VendorSheetWithQuotesDto>> {
  return toResult('getVendor', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, (context) => getVendorQuery(context, rawInput), {
      name: 'getVendor',
    });
  });
}

/** Procurement › Compare: items down, vendors across, for one company. */
export async function compareQuotes(rawInput: unknown): Promise<ActionResult<CompareQuotesDto>> {
  return toResult('compareQuotes', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (context) => compareQuotesQuery(context, rawInput),
      { name: 'compareQuotes' },
    );
  });
}
