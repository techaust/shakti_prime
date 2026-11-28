'use server';

import {
  CustomerDocumentsDto,
  DomainError,
  FileDocumentInput,
  hasGrant,
  ListCustomerDocumentsInput,
  ListDocumentRequirementsInput,
  SetDocumentRequirementInput,
  UnfileDocumentInput,
  ViewDocumentInput,
  type DocumentDto,
  type DocumentRequirementDto,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  fileDocument as fileDocumentCommand,
  getStoredFile,
  listCustomerDocuments,
  listDocumentRequirements as listDocumentRequirementsQuery,
  missingDocuments,
  setDocumentRequirement as setDocumentRequirementCommand,
  unfileDocument as unfileDocumentCommand,
  viewDocument,
} from '@shakti/domain';
import { requireFileStore } from '../files/uploads';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/*
 * J3 customer documents (docs/03-roadmap-appendix/phase4.md §6.3): thin wrappers over the
 * documents commands and reads, each run in the one company the page shows. Row security decides
 * which documents a caller reads; a sensitive one reaches only a holder of documents.sensitive.read.
 */

/** Account 360's Documents section: the customer's documents and the company's requirements. */
export async function loadCustomerDocuments(
  rawInput: unknown,
): Promise<ActionResult<CustomerDocumentsDto>> {
  return toResult('loadCustomerDocuments', async () => {
    const principal = await signedIn();
    const input = parseInput(ListCustomerDocumentsInput, rawInput);
    const { requestId } = await requestMeta();
    // One transaction, so the documents, the requirements and what is missing agree.
    const { documents, requirements, missing } = await executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      async (ctx) => {
        const documents = await listCustomerDocuments(ctx, input);
        const all = await listDocumentRequirementsQuery(ctx, { entityId: input.entityId });
        const requirements = all.filter((r) => r.active);
        // One answer per step that has a requirement, counting what the caller may not read.
        const steps = [...new Map(requirements.map((r) => [`${r.flow}/${r.stepKey}`, r])).values()];
        const missing = [];
        for (const r of steps) {
          missing.push({
            flow: r.flow,
            stepKey: r.stepKey,
            requirementKeys: await missingDocuments(ctx.tx, {
              entityId: input.entityId,
              accountId: input.accountId,
              projectId: null,
              flow: r.flow,
              stepKey: r.stepKey,
            }),
          });
        }
        return { documents, requirements, missing };
      },
      { name: 'loadCustomerDocuments' },
    );
    return CustomerDocumentsDto.parse({
      entityId: input.entityId,
      accountId: input.accountId,
      documents,
      requirements,
      missing,
      canFile: hasGrant(principal.permissions, 'documents.write', 'own'),
      canFileSensitive: hasGrant(principal.permissions, 'documents.sensitive.read', 'entity'),
    });
  });
}

/** Files a checked upload against the customer it was uploaded for. */
export async function fileDocument(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DocumentDto>> {
  return toResult('fileDocument', async () => {
    const principal = await signedIn();
    const input = parseInput(FileDocumentInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      fileDocumentCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/** Takes a document off its requirement, with the reason. */
export async function unfileDocument(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DocumentDto>> {
  return toResult('unfileDocument', async () => {
    const principal = await signedIn();
    const input = parseInput(UnfileDocumentInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      unfileDocumentCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}

/**
 * Opens a document's masked copy in a new tab through a short-lived address. Opening an identity
 * or bank paper is audited (`documents.document.view`); a customer document never opens through
 * `openFile`.
 */
export async function openDocument(rawInput: unknown): Promise<ActionResult<{ url: string }>> {
  return toResult('openDocument', async () => {
    const principal = await signedIn();
    const input = parseInput(ViewDocumentInput, rawInput);
    const meta = await requestMeta();
    const scope = { entityIds: [input.entityId], requestId: meta.requestId };
    const view = await executeCommand(principal, scope, viewDocument, input, commandOptions(meta));
    const file = await executeQuery(principal, scope, (ctx) => getStoredFile(ctx, view.fileId), {
      name: 'openDocument',
    });
    if (file?.status !== 'ready' || file.deletedAt !== null) {
      throw new DomainError('not_found', 'file not visible', { reason: 'file_missing' });
    }
    const store = requireFileStore();
    if (store.bucket !== file.bucket) {
      throw new DomainError('not_found', 'file kept in another store', { reason: 'file_missing' });
    }
    const get = await store.presignGet(file.key, { filename: file.name, disposition: 'inline' });
    return { url: get.url };
  });
}

/** Settings › Document requirements: one company's requirements, on or off. */
export async function listDocumentRequirements(
  rawInput: unknown,
): Promise<ActionResult<DocumentRequirementDto[]>> {
  return toResult('listDocumentRequirements', async () => {
    const principal = await signedIn();
    const input = parseInput(ListDocumentRequirementsInput, rawInput);
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { entityIds: [input.entityId], requestId },
      (ctx) => listDocumentRequirementsQuery(ctx, { entityId: input.entityId }),
      { name: 'listDocumentRequirements' },
    );
  });
}

/** Settings › Document requirements: adds a requirement to a step, or changes one. */
export async function setDocumentRequirement(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<DocumentRequirementDto>> {
  return toResult('setDocumentRequirement', async () => {
    const principal = await signedIn();
    const input = parseInput(SetDocumentRequirementInput, rawInput);
    const meta = await requestMeta();
    return executeCommand(
      principal,
      { entityIds: [input.entityId], requestId: meta.requestId },
      setDocumentRequirementCommand,
      input,
      commandOptions(meta, idempotencyKey),
    );
  });
}
