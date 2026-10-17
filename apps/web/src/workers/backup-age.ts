import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { AWS_DEFAULT_REGION } from '../aws-region';

/**
 * The age of the newest database copy (docs/05-database.md §10): production is copied every 6
 * hours by the backup stack's CodeBuild project, so a newest copy older than 7 hours, or none,
 * means the copies stopped (a failed run, a password the secret no longer holds, a schedule
 * switched off) and the hourly jobs check tells the owner. The app's AWS user may list the
 * copies' names and times, never read one.
 */
export const BACKUP_LATE_HOURS = 7;
/** The job name the alert carries, beside the database's scheduled jobs. */
export const BACKUP_JOB = 'database-backup';

export interface BackupCopy {
  key: string;
  at: Date;
}

/** Lists the copies under the given prefixes; the newest, or undefined when there is none. */
export interface BackupListing {
  newest(prefixes: readonly string[]): Promise<BackupCopy | undefined>;
}

export type BackupProblem = 'late' | 'missing';

/** Today's and yesterday's folders (UTC), the only ones a copy younger than 7 hours sits in. */
export function backupPrefixes(environment: string, now: Date): string[] {
  const day = (offset: number) => {
    const d = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `backups/${environment}/${String(d.getUTCFullYear())}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/`;
  };
  return [day(0), day(1)];
}

/** What is wrong with the copies now, if anything, and the newest copy's key. */
export async function backupProblem(
  listing: BackupListing,
  environment: string,
  now: Date,
): Promise<{ problem: BackupProblem | undefined; newest: string | undefined }> {
  const newest = await listing.newest(backupPrefixes(environment, now));
  if (newest === undefined) return { problem: 'missing', newest: undefined };
  const late = now.getTime() - newest.at.getTime() > BACKUP_LATE_HOURS * 60 * 60 * 1000;
  return { problem: late ? 'late' : undefined, newest: newest.key };
}

/** The listing of the backup bucket with the app's own AWS credentials. */
export function s3BackupListing(bucket: string, region: string, client?: S3Client): BackupListing {
  const s3 = client ?? new S3Client({ region });
  return {
    async newest(prefixes) {
      let found: BackupCopy | undefined;
      for (const prefix of prefixes) {
        let token: string | undefined;
        do {
          const page = await s3.send(
            new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
          );
          for (const object of page.Contents ?? []) {
            if (object.Key === undefined || object.LastModified === undefined) continue;
            if (found === undefined || object.LastModified > found.at) {
              found = { key: object.Key, at: object.LastModified };
            }
          }
          token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
        } while (token !== undefined);
      }
      return found;
    },
  };
}

/**
 * The backup check of this runtime: with `BACKUP_BUCKET` set (production, where it is required),
 * the bucket's listing for `BOS_ENVIRONMENT`; otherwise none, as on dev and staging.
 */
export function configuredBackupCheck(
  env: NodeJS.ProcessEnv = process.env,
): { listing: BackupListing; environment: string } | undefined {
  const bucket = env.BACKUP_BUCKET ?? '';
  const environment = env.BOS_ENVIRONMENT ?? '';
  if (bucket === '' || environment === '') return undefined;
  const region = env.AWS_REGION ?? '';
  return {
    listing: s3BackupListing(bucket, region === '' ? AWS_DEFAULT_REGION : region),
    environment,
  };
}
