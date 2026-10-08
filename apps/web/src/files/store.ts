import { localDiskFileStore, type FileStore } from '@shakti/domain';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { hostedRuntime } from '../auth/deps';
import { AWS_DEFAULT_REGION } from '../aws-region';
import { s3FileStore } from './s3-store';

/** The path of the development upload and download route, under the app's own address. */
export const LOCAL_FILES_PATH = '/api/v1/files/local';

/** The S3 settings, when both the bucket and its key are set; the credentials are AWS's own. */
export function s3Settings(
  env: NodeJS.ProcessEnv = process.env,
): { bucket: string; kmsKeyId: string; region: string } | undefined {
  const bucket = env.FILES_BUCKET ?? '';
  const kmsKeyId = env.FILES_KMS_KEY_ID ?? '';
  if (bucket === '' || kmsKeyId === '') return undefined;
  const region = env.AWS_REGION ?? '';
  return { bucket, kmsKeyId, region: region === '' ? AWS_DEFAULT_REGION : region };
}

// Signs the development store's addresses when no auth secret is set: they then last only as
// long as this process, which a developer's machine can live with.
let processSecret: string | undefined;

function localSigning(env: NodeJS.ProcessEnv): { secret: string; url: (token: string) => string } {
  const configured = env.BETTER_AUTH_SECRET ?? '';
  processSecret ??= randomBytes(32).toString('base64url');
  const secret = configured === '' ? processSecret : `local-files:${configured}`;
  const origin = (env.BETTER_AUTH_URL ?? '') === '' ? 'http://localhost:3000' : env.BETTER_AUTH_URL;
  return { secret, url: (token) => `${String(origin)}${LOCAL_FILES_PATH}/${token}` };
}

let store: FileStore | undefined;

/**
 * Where uploaded files are kept (docs/04-architecture.md §9): the environment's S3 bucket when
 * `FILES_BUCKET` and `FILES_KMS_KEY_ID` are set; on a developer's machine, `apps/web/.data/files`
 * (ignored by git) with the development upload route; on a hosted deployment without S3, none,
 * so uploads there answer unavailable rather than land on a server's short-lived disk.
 */
export function fileStore(env: NodeJS.ProcessEnv = process.env): FileStore | undefined {
  if (store !== undefined) return store;
  const s3 = s3Settings(env);
  if (s3 !== undefined) {
    store = s3FileStore(s3);
    return store;
  }
  if (hostedRuntime(env)) return undefined;
  store = localDiskFileStore(join(process.cwd(), '.data', 'files'), {
    signing: localSigning(env),
  });
  return store;
}

/** The secret the development route checks addresses with; the same one `fileStore()` signs with. */
export function localFilesSecret(env: NodeJS.ProcessEnv = process.env): string {
  return localSigning(env).secret;
}

/** For tests: forget the chosen store. */
export function resetFileStore(): void {
  store = undefined;
}
