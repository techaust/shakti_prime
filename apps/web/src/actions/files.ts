'use server';

import {
  DomainError,
  FileCompleteRequest,
  FilePresignRequest,
  IdSchema,
  type FileDto,
  type FilePresignResponse,
  type Principal,
} from '@shakti/contracts';
import {
  executeQuery,
  getFile,
  getStoredFile,
  listCompanyFiles as listCompanyFilesQuery,
} from '@shakti/domain';
import { countRequest } from '../auth/request-cap';
import { defaultAuthDeps } from '../auth/deps';
import { FILE_ROUTE_CAP } from '../files/routes';
import { completeUploadFor, presignUpload, requireFileStore } from '../files/uploads';
import { toResult, type ActionResult } from './result';
import { commandOptions, parseInput, requestMeta, signedIn } from './support';

/*
 * Uploads from the screens (docs/ARCHITECTURE.md §9): thin wrappers over the same flow as
 * `POST /api/v1/files/presign` and `/files/:id/complete`. The browser sends the bytes straight to
 * the signed address; these only record the file and check what landed.
 */

/**
 * The same cap per person as the upload routes (`FILE_ROUTE_CAP`, one count for both doors):
 * every call is audited, so a runaway screen must not fill the Activity log.
 */
async function withinUploadCap(principal: Principal): Promise<void> {
  const counted = await countRequest(
    defaultAuthDeps().keyValue,
    `files:${principal.id}`,
    FILE_ROUTE_CAP,
  );
  if (!counted.allowed) {
    throw new DomainError('rate_limited', 'too many upload calls', {
      retryAfter: counted.retryAfter,
    });
  }
}

/** Records the upload and answers its signed address; the uploader's own key per file. */
export async function startUpload(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<FilePresignResponse>> {
  return toResult('startUpload', async () => {
    const principal = await signedIn();
    await withinUploadCap(principal);
    const input = parseInput(FilePresignRequest, rawInput);
    const meta = await requestMeta();
    return presignUpload(principal, input, {
      requestId: meta.requestId,
      options: commandOptions(meta, idempotencyKey),
    });
  });
}

/** The bytes landed: the file waits for its checks. */
export async function finishUpload(
  rawInput: unknown,
  idempotencyKey?: unknown,
): Promise<ActionResult<FileDto>> {
  return toResult('finishUpload', async () => {
    const principal = await signedIn();
    await withinUploadCap(principal);
    const input = parseInput(FileCompleteRequest.extend({ fileId: IdSchema }).strict(), rawInput);
    const meta = await requestMeta();
    return completeUploadFor(principal, input.fileId, input.purpose, {
      requestId: meta.requestId,
      options: commandOptions(meta, idempotencyKey),
    });
  });
}

/** One file as it stands, for the uploader waiting on its checks. */
export async function fileStatus(rawFileId: unknown): Promise<ActionResult<FileDto>> {
  return toResult('fileStatus', async () => {
    const principal = await signedIn();
    const fileId = parseInput(IdSchema, rawFileId);
    const { requestId } = await requestMeta();
    const file = await executeQuery(principal, { requestId }, (ctx) => getFile(ctx, fileId), {
      name: 'fileStatus',
    });
    if (file === undefined) {
      throw new DomainError('not_found', 'file not visible', { reason: 'file_missing' });
    }
    return file;
  });
}

/** A short-lived address that opens a checked file the caller may read. */
export async function openFile(rawFileId: unknown): Promise<ActionResult<{ url: string }>> {
  return toResult('openFile', async () => {
    const principal = await signedIn();
    const fileId = parseInput(IdSchema, rawFileId);
    const { requestId } = await requestMeta();
    const file = await executeQuery(principal, { requestId }, (ctx) => getStoredFile(ctx, fileId), {
      name: 'openFile',
    });
    if (file?.status !== 'ready') {
      throw new DomainError('not_found', 'file not visible', { reason: 'file_missing' });
    }
    // Signed by the store that holds the file's bucket; a file kept elsewhere is not opened here.
    const store = requireFileStore();
    if (store.bucket !== file.bucket) {
      throw new DomainError('not_found', 'file kept in another store', { reason: 'file_missing' });
    }
    const get = await store.presignGet(file.key, {
      filename: file.name,
      disposition: 'inline',
    });
    return { url: get.url };
  });
}

/** Each company's current logo and letterhead, for Settings › Companies. */
export async function listCompanyBranding(): Promise<ActionResult<FileDto[]>> {
  return toResult('listCompanyBranding', async () => {
    const principal = await signedIn();
    const { requestId } = await requestMeta();
    return executeQuery(
      principal,
      { requestId },
      (ctx) => listCompanyFilesQuery(ctx, ['entity_logo', 'letterhead']),
      { name: 'listCompanyBranding' },
    );
  });
}
