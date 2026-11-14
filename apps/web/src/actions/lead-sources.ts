'use server';

// Settings › Lead sources, the qualification card and Integration health's leads with no owner
// (docs/03-roadmap-appendix/phase2.md §6.2). Thin wrappers (docs/06-api.md §4): parse → request
// context → command or query → DTO.

import {
  ArchiveIngestSourceInput,
  CreateIngestKeyRequest,
  ListIngestSourcesInput,
  ReadLeadQualificationInput,
  RevokeIngestKeyInput,
  SetIngestSourceInput,
  SetLeadQualificationInput,
  type IngestKeyDto,
  type IngestSourceDto,
  type IngestSourcesDto,
  type LeadQualificationDto,
  type UnownedIngestLeadsDto,
} from '@shakti/contracts';
import {
  archiveIngestSource as archiveIngestSourceCommand,
  createIngestKey as createIngestKeyCommand,
  executeCommand,
  executeQuery,
  listIngestSources as listIngestSourcesQuery,
  listUnownedIngestLeads,
  newIngestKey,
  readLeadQualification,
  revokeIngestKey as revokeIngestKeyCommand,
  setIngestSource as setIngestSourceCommand,
  setLeadQualification as setLeadQualificationCommand,
} from '@shakti/domain';
import { fieldCipher } from '../crypto/kms-cipher';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/** A company's connected forms and sites and its website keys. */
export async function listIngestSources(
  rawInput: unknown,
): Promise<ActionResult<IngestSourcesDto>> {
  return toResult('listIngestSources', async () => {
    const principal = await signedIn();
    const input = parseInput(ListIngestSourcesInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (ctx) => listIngestSourcesQuery(ctx, input),
      { name: 'listIngestSources' },
    );
  });
}

/** Connects or changes a form, Page or site; a Page token is sealed before it is stored. */
export async function setIngestSource(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<IngestSourceDto>> {
  return toResult('setIngestSource', async () => {
    const principal = await signedIn();
    const input = parseInput(SetIngestSourceInput, rawInput);
    const meta = await requestMeta();
    const cipher = fieldCipher();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      setIngestSourceCommand,
      input,
      {
        ...commandOptions(meta, idempotencyKey),
        ...(cipher === undefined ? {} : { fieldCipher: cipher }),
      },
    );
  });
}

export async function archiveIngestSource(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<IngestSourceDto>> {
  return toResult('archiveIngestSource', async () => {
    const principal = await signedIn();
    const input = parseInput(ArchiveIngestSourceInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      archiveIngestSourceCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/**
 * Makes a website key: the key is made here, its hash and last four characters go to the command,
 * and the key itself is answered once, for the Executive to copy into the website's settings.
 */
export async function createIngestKey(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<{ key: IngestKeyDto; secret: string }>> {
  return toResult('createIngestKey', async () => {
    const principal = await signedIn();
    const input = parseInput(CreateIngestKeyRequest, rawInput);
    const meta = await requestMeta();
    const made = newIngestKey();
    const key = await executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      createIngestKeyCommand,
      {
        entityId: input.entityId,
        label: input.label,
        keyHash: made.keyHash,
        keyHint: made.keyHint,
      },
      commandOptions(meta, idempotencyKey),
    );
    return { key, secret: made.key };
  });
}

export async function revokeIngestKey(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<IngestKeyDto>> {
  return toResult('revokeIngestKey', async () => {
    const principal = await signedIn();
    const input = parseInput(RevokeIngestKeyInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      revokeIngestKeyCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** The qualification card: the lead's facts. */
export async function leadQualification(
  rawInput: unknown,
): Promise<ActionResult<LeadQualificationDto>> {
  return toResult('leadQualification', async () => {
    const principal = await signedIn();
    const input = parseInput(ReadLeadQualificationInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (ctx) => readLeadQualification(ctx, input),
      { name: 'leadQualification' },
    );
  });
}

export async function setLeadQualification(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<LeadQualificationDto>> {
  return toResult('setLeadQualification', async () => {
    const principal = await signedIn();
    const input = parseInput(SetLeadQualificationInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      setLeadQualificationCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Integration health: open leads from an integration with no owner, in the caller's companies. */
export async function unownedIngestLeads(): Promise<ActionResult<UnownedIngestLeadsDto>> {
  return toResult('unownedIngestLeads', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(principal, { requestId }, listUnownedIngestLeads, {
      name: 'unownedIngestLeads',
    });
  });
}
