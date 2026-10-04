import {
  DomainError,
  FilePresignResponse,
  type FileDto,
  type FilePresignRequest,
  type FilePurpose,
  type Principal,
} from '@shakti/contracts';
import {
  beginUpload,
  completeUpload,
  executeCommand,
  executeQuery,
  getStoredFile,
  type ExecuteOptions,
  type FileStore,
} from '@shakti/domain';
import { fileStore } from './store';

/** The request's own details, as the actions and routes pass them to every command. */
export interface UploadCall {
  requestId: string;
  options: ExecuteOptions;
}

/** The environment's store, or `integration_unavailable` on a hosted runtime without S3. */
export function requireFileStore(store: FileStore | undefined = fileStore()): FileStore {
  if (store === undefined) {
    throw new DomainError('integration_unavailable', 'no file store on this deployment', {
      reason: 'files_unavailable',
    });
  }
  return store;
}

/**
 * `POST /files/presign` and the screens' `startUpload`: `files.upload.begin` records the file,
 * then the store signs the upload address for the key it recorded. A repeat with the same
 * idempotency key replays the record and signs a fresh address for it.
 */
export async function presignUpload(
  principal: Principal,
  input: FilePresignRequest,
  call: UploadCall,
  store: FileStore = requireFileStore(),
): Promise<FilePresignResponse> {
  const slot = await executeCommand(
    principal,
    { entityIds: [input.entityId], requestId: call.requestId },
    beginUpload,
    { ...input, bucket: store.bucket },
    call.options,
  );
  const put = await store.presignPut({
    key: slot.key,
    contentType: slot.contentType,
    size: slot.size,
    sha256: slot.sha256,
  });
  return FilePresignResponse.parse({
    fileId: slot.fileId,
    method: put.method,
    uploadUrl: put.url,
    headers: put.headers,
    expiresAt: put.expiresAt.toISOString(),
  });
}

/**
 * `POST /files/:id/complete` and the screens' `finishUpload`: the store is asked what landed
 * under the file's key, and `files.upload.complete` compares it with what the upload declared.
 */
export async function completeUploadFor(
  principal: Principal,
  fileId: string,
  purpose: FilePurpose,
  call: UploadCall,
  store: FileStore = requireFileStore(),
): Promise<FileDto> {
  const file = await executeQuery(
    principal,
    { requestId: call.requestId },
    (ctx) => getStoredFile(ctx, fileId),
    { name: 'files.upload.read' },
  );
  if (file?.purpose !== purpose) {
    throw new DomainError('not_found', `file ${fileId} is not visible`, { reason: 'file_missing' });
  }
  const stored = await store.head(file.key);
  return executeCommand(
    principal,
    { entityIds: [file.entityId], requestId: call.requestId },
    completeUpload,
    {
      fileId,
      purpose,
      stored: { size: stored?.size ?? 0, sha256: stored?.sha256 ?? null },
    },
    call.options,
  );
}
