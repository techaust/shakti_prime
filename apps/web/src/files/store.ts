import { localDiskFileStore, type FileStore } from '@shakti/domain';
import { join } from 'node:path';
import { hostedRuntime } from '../auth/deps';

let store: FileStore | undefined;

/**
 * Where uploaded files are kept. Locally they go under `apps/web/.data/files` (ignored by git);
 * a hosted deployment has no store until the S3 bucket in Mumbai is set up, so uploads there
 * are refused rather than written to a server's short-lived disk.
 */
export function fileStore(): FileStore | undefined {
  if (hostedRuntime()) return undefined;
  store ??= localDiskFileStore(join(process.cwd(), '.data', 'files'));
  return store;
}
