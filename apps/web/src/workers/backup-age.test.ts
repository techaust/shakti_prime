import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  backupPrefixes,
  backupProblem,
  configuredBackupCheck,
  s3BackupListing,
  type BackupListing,
} from './backup-age';

const client = new S3Client({
  region: 'ap-south-1',
  credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test secret phrase' },
});
const s3 = mockClient(client);
const NOW = new Date('2027-01-01T03:10:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);
const listing = (at: Date | undefined): BackupListing => ({
  newest: () => Promise.resolve(at === undefined ? undefined : { key: 'backups/x.dump', at }),
});

beforeEach(() => {
  s3.reset();
});

describe('the age of the newest database copy (docs/05-database.md §10)', () => {
  it("looks in today's and yesterday's folders, across a year's end", () => {
    expect(backupPrefixes('production', NOW)).toEqual([
      'backups/production/2027/01/01/',
      'backups/production/2026/12/31/',
    ]);
  });

  it('is fine up to 7 hours, late after, and missing with no copy in two days', async () => {
    expect(await backupProblem(listing(hoursAgo(6.9)), 'production', NOW)).toEqual({
      problem: undefined,
      newest: 'backups/x.dump',
    });
    expect(await backupProblem(listing(hoursAgo(7.1)), 'production', NOW)).toEqual({
      problem: 'late',
      newest: 'backups/x.dump',
    });
    expect(await backupProblem(listing(undefined), 'production', NOW)).toEqual({
      problem: 'missing',
      newest: undefined,
    });
  });

  it("lists the bucket's copies page by page and takes the newest", async () => {
    s3.on(ListObjectsV2Command, { Prefix: 'backups/production/2027/01/01/' })
      .resolvesOnce({
        Contents: [{ Key: 'backups/production/2027/01/01/a.dump', LastModified: hoursAgo(2.8) }],
        IsTruncated: true,
        NextContinuationToken: 'next',
      })
      .resolvesOnce({ Contents: [{ Key: 'no-time' }], IsTruncated: false });
    s3.on(ListObjectsV2Command, { Prefix: 'backups/production/2026/12/31/' }).resolves({
      Contents: [{ Key: 'backups/production/2026/12/31/b.dump', LastModified: hoursAgo(8.8) }],
    });
    const newest = await s3BackupListing(
      'shakti-prime-production-backups',
      'ap-south-1',
      client,
    ).newest(backupPrefixes('production', NOW));
    expect(newest).toEqual({ key: 'backups/production/2027/01/01/a.dump', at: hoursAgo(2.8) });
    const calls = s3.commandCalls(ListObjectsV2Command).map((c) => c.args[0].input);
    expect(calls).toEqual([
      { Bucket: 'shakti-prime-production-backups', Prefix: 'backups/production/2027/01/01/' },
      {
        Bucket: 'shakti-prime-production-backups',
        Prefix: 'backups/production/2027/01/01/',
        ContinuationToken: 'next',
      },
      { Bucket: 'shakti-prime-production-backups', Prefix: 'backups/production/2026/12/31/' },
    ]);
  });

  it('is checked only where the bucket is named, as on production', () => {
    const env = (values: Record<string, string>): NodeJS.ProcessEnv => ({
      NODE_ENV: 'production',
      ...values,
    });
    expect(configuredBackupCheck(env({ BOS_ENVIRONMENT: 'staging' }))).toBeUndefined();
    const production = env({ BOS_ENVIRONMENT: 'production', BACKUP_BUCKET: 'b' });
    expect(configuredBackupCheck(production)?.environment).toBe('production');
  });
});
