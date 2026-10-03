import {
  DeleteObjectsCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertFileKey,
  contentDisposition,
  PRESIGN_SECONDS,
  sha256Hex,
  type FileStore,
} from '@shakti/domain';

export interface S3StoreConfig {
  bucket: string;
  /** The environment's KMS key (id, ARN or alias) every object is encrypted with. */
  kmsKeyId: string;
  region: string;
  /** For tests: a client with fixed credentials; otherwise the standard AWS variables are read. */
  client?: S3Client;
  now?: () => Date;
}

/** The headers a signed upload binds besides the type and length: checksum and encryption. */
export const BOUND_AMZ_HEADERS = [
  'x-amz-checksum-sha256',
  'x-amz-server-side-encryption',
  'x-amz-server-side-encryption-aws-kms-key-id',
];

const hexToBase64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64');
const base64ToHex = (b64: string): string => Buffer.from(b64, 'base64').toString('hex');

function isMissing(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'NotFound' ||
      error.name === 'NoSuchKey' ||
      error.$metadata.httpStatusCode === 404)
  );
}

function alreadyThere(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.name === 'PreconditionFailed' || error.$metadata.httpStatusCode === 412)
  );
}

/**
 * The hosted file store (docs/ARCHITECTURE.md §9): one S3 bucket per environment in Mumbai,
 * versioned, with SSE-KMS under the environment's key and GuardDuty Malware Protection tagging
 * each new object with its verdict. Uploads and downloads use signed addresses that work for
 * `PRESIGN_SECONDS`; an upload's type, length, SHA-256 and encryption are part of its signature,
 * so S3 refuses any other bytes.
 */
export function s3FileStore(config: S3StoreConfig): FileStore {
  const client =
    config.client ??
    new S3Client({
      region: config.region,
      // Checksums only where S3 requires one: a signed upload names its own SHA-256, and a
      // checksum the SDK added of its own would be signed for an empty body.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  const now = config.now ?? (() => new Date());
  const Bucket = config.bucket;
  const encryption = {
    ServerSideEncryption: 'aws:kms' as const,
    SSEKMSKeyId: config.kmsKeyId,
  };

  return {
    bucket: Bucket,
    scanned: true,
    async put(key, bytes, contentType) {
      assertFileKey(key);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
            ChecksumSHA256: hexToBase64(sha256Hex(bytes)),
            // Once per key: bytes already under it are kept (S3 answers 412).
            IfNoneMatch: '*',
            ...encryption,
          }),
        );
      } catch (error) {
        if (!alreadyThere(error)) throw error;
      }
    },
    async get(key) {
      assertFileKey(key);
      try {
        const out = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return out.Body === undefined ? undefined : await out.Body.transformToByteArray();
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async presignPut(request) {
      assertFileKey(request.key);
      const checksum = hexToBase64(request.sha256);
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key: request.key,
          ContentType: request.contentType,
          ContentLength: request.size,
          ChecksumSHA256: checksum,
          ...encryption,
        }),
        {
          expiresIn: PRESIGN_SECONDS,
          signableHeaders: new Set(['content-type', 'content-length']),
          unhoistableHeaders: new Set(BOUND_AMZ_HEADERS),
        },
      );
      return {
        url,
        method: 'PUT',
        headers: {
          'content-type': request.contentType,
          'x-amz-checksum-sha256': checksum,
          'x-amz-server-side-encryption': 'aws:kms',
          'x-amz-server-side-encryption-aws-kms-key-id': config.kmsKeyId,
        },
        expiresAt: new Date(now().getTime() + PRESIGN_SECONDS * 1000),
      };
    },
    async presignGet(key, options) {
      assertFileKey(key);
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(options),
        }),
        { expiresIn: PRESIGN_SECONDS },
      );
      return { url, expiresAt: new Date(now().getTime() + PRESIGN_SECONDS * 1000) };
    },
    async head(key) {
      assertFileKey(key);
      try {
        const out = await client.send(
          new HeadObjectCommand({ Bucket, Key: key, ChecksumMode: 'ENABLED' }),
        );
        return {
          size: out.ContentLength ?? 0,
          contentType: out.ContentType,
          sha256: out.ChecksumSHA256 === undefined ? undefined : base64ToHex(out.ChecksumSHA256),
        };
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async tags(key) {
      assertFileKey(key);
      const out = await client.send(new GetObjectTaggingCommand({ Bucket, Key: key }));
      const tags: Record<string, string> = {};
      for (const tag of out.TagSet ?? []) {
        if (tag.Key !== undefined && tag.Value !== undefined) tags[tag.Key] = tag.Value;
      }
      return tags;
    },
    async delete(key) {
      assertFileKey(key);
      // The bucket keeps versions, so removing the current object alone would leave the bytes in
      // an older version: every version and delete marker of the key goes.
      const listed = await client.send(new ListObjectVersionsCommand({ Bucket, Prefix: key }));
      const versions = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])]
        .filter((v) => v.Key === key && v.VersionId !== undefined)
        .map((v) => ({ Key: key, VersionId: v.VersionId }));
      if (versions.length === 0) return;
      const out = await client.send(
        new DeleteObjectsCommand({ Bucket, Delete: { Objects: versions, Quiet: true } }),
      );
      if ((out.Errors ?? []).length > 0) {
        throw new Error(`the store kept ${String(out.Errors?.length)} versions of the object`);
      }
    },
  };
}
