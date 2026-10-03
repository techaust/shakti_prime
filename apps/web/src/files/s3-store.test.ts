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
import { sha256Hex } from '@shakti/domain';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { s3FileStore } from './s3-store';

// Credentials that sign nothing real: only the shape of a signed address is checked.
const client = new S3Client({
  region: 'ap-south-1',
  credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test secret phrase' },
  requestChecksumCalculation: 'WHEN_REQUIRED',
});
const s3 = mockClient(client);
const NOW = new Date('2026-09-29T06:00:00.000Z');
const store = s3FileStore({
  bucket: 'shakti-prime-dev-files',
  kmsKeyId: 'alias/shakti-prime-dev-files',
  region: 'ap-south-1',
  client,
  now: () => NOW,
});
const bytes = Uint8Array.from([1, 2, 3]);
const hex = sha256Hex(bytes);
const b64 = Buffer.from(hex, 'hex').toString('base64');

function serviceError(name: string, status: number): S3ServiceException {
  return new S3ServiceException({
    name,
    $fault: 'client',
    $metadata: { httpStatusCode: status },
    message: name,
  });
}

beforeEach(() => {
  s3.reset();
});

describe('the S3 file store', () => {
  it('is the scanned store, named by its bucket', () => {
    expect(store.bucket).toBe('shakti-prime-dev-files');
    expect(store.scanned).toBe(true);
  });

  it('signs an upload with its type, length, checksum and encryption bound for 15 minutes', async () => {
    const put = await store.presignPut({
      key: '1/entity_logo/019.png',
      contentType: 'image/png',
      size: 3,
      sha256: hex,
    });
    const url = new URL(put.url);
    expect(url.hostname).toBe('shakti-prime-dev-files.s3.ap-south-1.amazonaws.com');
    expect(url.pathname).toBe('/1/entity_logo/019.png');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    const signed = (url.searchParams.get('X-Amz-SignedHeaders') ?? '').split(';');
    for (const header of [
      'content-type',
      'content-length',
      'x-amz-checksum-sha256',
      'x-amz-server-side-encryption',
      'x-amz-server-side-encryption-aws-kms-key-id',
    ]) {
      expect(signed).toContain(header);
    }
    expect(put.headers).toEqual({
      'content-type': 'image/png',
      'x-amz-checksum-sha256': b64,
      'x-amz-server-side-encryption': 'aws:kms',
      'x-amz-server-side-encryption-aws-kms-key-id': 'alias/shakti-prime-dev-files',
    });
    expect(put.expiresAt.toISOString()).toBe('2026-09-29T06:15:00.000Z');
    // Signing sends nothing.
    expect(s3.calls()).toHaveLength(0);
  });

  it('signs a download under the name given', async () => {
    const get = await store.presignGet('1/letterhead/019.png', {
      filename: 'Letterhead.png',
      disposition: 'attachment',
    });
    const url = new URL(get.url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('response-content-disposition')).toContain(
      'attachment; filename="Letterhead.png"',
    );
  });

  it('stores bytes once, encrypted, with their checksum', async () => {
    s3.on(PutObjectCommand).resolves({});
    await store.put('1/quote_pdf/a.pdf', bytes, 'application/pdf');
    const [call] = s3.commandCalls(PutObjectCommand);
    expect(call?.args[0].input).toMatchObject({
      Bucket: 'shakti-prime-dev-files',
      Key: '1/quote_pdf/a.pdf',
      ContentType: 'application/pdf',
      ChecksumSHA256: b64,
      IfNoneMatch: '*',
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: 'alias/shakti-prime-dev-files',
    });
  });

  it('keeps bytes already under the key', async () => {
    s3.on(PutObjectCommand).rejects(serviceError('PreconditionFailed', 412));
    await expect(store.put('1/a.pdf', bytes, 'application/pdf')).resolves.toBeUndefined();
  });

  it('passes on any other failure to store', async () => {
    s3.on(PutObjectCommand).rejects(serviceError('AccessDenied', 403));
    await expect(store.put('1/a.pdf', bytes, 'application/pdf')).rejects.toThrow('AccessDenied');
  });

  it('reads an object and its checksum, and answers undefined for a missing one', async () => {
    s3.on(HeadObjectCommand, { Key: '1/a.png' })
      .resolves({ ContentLength: 3, ContentType: 'image/png', ChecksumSHA256: b64 })
      .on(HeadObjectCommand, { Key: '1/missing.png' })
      .rejects(serviceError('NotFound', 404));
    expect(await store.head('1/a.png')).toEqual({ size: 3, contentType: 'image/png', sha256: hex });
    expect(s3.commandCalls(HeadObjectCommand)[0]?.args[0].input.ChecksumMode).toBe('ENABLED');
    expect(await store.head('1/missing.png')).toBeUndefined();
  });

  it('reads the bytes, and undefined for a missing key', async () => {
    s3.on(GetObjectCommand, { Key: '1/a.png' })
      .resolves({
        Body: { transformToByteArray: () => Promise.resolve(bytes) } as never,
      })
      .on(GetObjectCommand, { Key: '1/none.png' })
      .rejects(serviceError('NoSuchKey', 404));
    expect(await store.get('1/a.png')).toEqual(bytes);
    expect(await store.get('1/none.png')).toBeUndefined();
  });

  it('reads the malware scanner’s tag', async () => {
    s3.on(GetObjectTaggingCommand).resolves({
      TagSet: [{ Key: 'GuardDutyMalwareScanStatus', Value: 'NO_THREATS_FOUND' }],
    });
    expect(await store.tags('1/a.png')).toEqual({
      GuardDutyMalwareScanStatus: 'NO_THREATS_FOUND',
    });
  });

  it('removes every version of the key and nothing under a longer name', async () => {
    s3.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { Key: '1/a.png', VersionId: 'v2' },
        { Key: '1/a.png', VersionId: 'v1' },
        { Key: '1/a.png.old', VersionId: 'v9' },
      ],
      DeleteMarkers: [{ Key: '1/a.png', VersionId: 'm1' }],
    });
    s3.on(DeleteObjectsCommand).resolves({});
    await store.delete('1/a.png');
    const [call] = s3.commandCalls(DeleteObjectsCommand);
    expect(call?.args[0].input.Delete?.Objects).toEqual([
      { Key: '1/a.png', VersionId: 'v2' },
      { Key: '1/a.png', VersionId: 'v1' },
      { Key: '1/a.png', VersionId: 'm1' },
    ]);
  });

  it('says so when a version could not be removed', async () => {
    s3.on(ListObjectVersionsCommand).resolves({ Versions: [{ Key: '1/a.png', VersionId: 'v1' }] });
    s3.on(DeleteObjectsCommand).resolves({ Errors: [{ Key: '1/a.png', Code: 'AccessDenied' }] });
    await expect(store.delete('1/a.png')).rejects.toThrow('kept 1 versions');
  });

  it('does nothing for a key with no versions', async () => {
    s3.on(ListObjectVersionsCommand).resolves({});
    await store.delete('1/a.png');
    expect(s3.commandCalls(DeleteObjectsCommand)).toHaveLength(0);
  });

  it('refuses an unsafe key before any call', async () => {
    await expect(store.head('../x')).rejects.toThrow('not a safe path');
    expect(s3.calls()).toHaveLength(0);
  });
});
