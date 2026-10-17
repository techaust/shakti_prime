// Gives production's backup login, app_backup, a new password and puts its address in AWS Secrets
// Manager, where only the backup's CodeBuild project reads it (docs/runbooks/deploy.md §1 step 4,
// §5; docs/05-database.md §10). The owner runs it through tools/secrets/set-backup-login.ps1, with
// the production database password typed into a hidden prompt and the AWS command line signed in
// as the account's administrator. Node 24 runs this file as it is, so it imports only Node's own
// modules and `postgres`.
//
// The password is made here and never shown. The database receives only its SCRAM verifier, which
// can check a password but not sign in, so the statement in the server's log holds nothing usable,
// and GitHub never holds the password at all.
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

/** The production Supabase project, its AWS account and region, and the secret the backup reads. */
export const PRODUCTION_PROJECT_REF = 'ifnoytyhnedgiyhxxhhu';
export const BACKUP_SECRET = 'shakti-prime-production-backup-database';
const AWS_ACCOUNT = '199476069348';
const AWS_REGION = 'ap-south-1';

/** Supabase's session pooler in Mumbai, the only host the backup connects to. */
const POOLER_HOST = /^aws-[0-9]+-ap-south-1\.pooler\.supabase\.com$/;
const BASE64 = '[A-Za-z0-9+/]+={0,2}';
const SCRAM_VERIFIER = new RegExp(`^SCRAM-SHA-256\\$[0-9]+:${BASE64}\\$${BASE64}:${BASE64}$`);
const SCRAM_ITERATIONS = 4096;

/**
 * The form in which Postgres keeps a password under `scram-sha-256` (RFC 5802, RFC 7677):
 * `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`. Postgres takes it as given in
 * `alter role … password`, so the password itself never reaches the server. The password must be
 * printable ASCII, which SASLprep leaves as it is.
 */
export function scramVerifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations: number = SCRAM_ITERATIONS,
): string {
  if (!/^[\x21-\x7e]+$/.test(password)) throw new Error('the password must be printable ASCII');
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${String(iterations)}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** A new password: 32 random bytes, URL-safe, so the address needs no escaping. */
export function newBackupPassword(): string {
  return randomBytes(32).toString('base64url');
}

/** A login's session pooler address on the project; the backup's copy script accepts no other. */
export function poolerAddress(
  login: 'app_backup' | 'postgres',
  host: string,
  password: string,
  projectRef: string = PRODUCTION_PROJECT_REF,
): string {
  if (!POOLER_HOST.test(host)) {
    throw new Error(
      'the host is not a Supabase session pooler in Mumbai (aws-N-ap-south-1.pooler.supabase.com)',
    );
  }
  return `postgresql://${login}.${projectRef}:${encodeURIComponent(password)}@${host}:5432/postgres`;
}

/** Gives `app_backup` the password this verifier checks; refuses anything but a verifier. */
export async function setBackupVerifier(sql: postgres.ISql, verifier: string): Promise<void> {
  if (!SCRAM_VERIFIER.test(verifier)) throw new Error('not a SCRAM-SHA-256 verifier');
  const [role] = await sql<{ found: number }[]>`
    select count(*)::int as found from pg_roles where rolname = 'app_backup'`;
  if (role?.found !== 1) {
    throw new Error('app_backup does not exist yet: the first release makes it (deploy §2)');
  }
  // The verifier holds only base64, digits and `$:-`, checked above.
  await sql.unsafe(`alter role app_backup with password '${verifier}'`);
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function aws(args: string[]): string {
  return execFileSync('aws', [...args, '--region', AWS_REGION, '--output', 'text'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

async function main(): Promise<void> {
  const databasePassword = required('PRODUCTION_DATABASE_PASSWORD');
  const host = required('POOLER_HOST');
  const ca = readFileSync(required('CA_CERT_FILE'), 'utf8');
  if (!ca.includes('-----BEGIN CERTIFICATE-----'))
    throw new Error('CA_CERT_FILE is not a PEM certificate');
  const ssl = { ca, rejectUnauthorized: true };

  // AWS first, so nothing changes in the database unless the secret can be written after it.
  const account = aws(['sts', 'get-caller-identity', '--query', 'Account']);
  if (account !== AWS_ACCOUNT)
    throw new Error(`the AWS command line is signed in to ${account}, not ${AWS_ACCOUNT}`);
  aws(['secretsmanager', 'describe-secret', '--secret-id', BACKUP_SECRET, '--query', 'Name']);

  const password = newBackupPassword();
  const migrator = postgres(poolerAddress('postgres', host, databasePassword), {
    ssl,
    max: 1,
    prepare: false,
    connect_timeout: 15,
    onnotice: () => undefined,
  });
  try {
    await setBackupVerifier(migrator, scramVerifier(password));
  } finally {
    await migrator.end({ timeout: 5 });
  }

  // Sign in as the backup will, through the pooler with the certificate checked.
  const url = poolerAddress('app_backup', host, password);
  const backup = postgres(url, { ssl, max: 1, prepare: false, connect_timeout: 15 });
  let tables: number;
  try {
    const [row] = await backup<{ tables: number }[]>`
      select count(*)::int as tables from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'app') and c.relkind = 'r' and has_table_privilege(c.oid, 'SELECT')`;
    tables = row?.tables ?? 0;
  } finally {
    await backup.end({ timeout: 5 });
  }

  const folder = mkdtempSync(join(tmpdir(), 'shakti-backup-'));
  try {
    const file = join(folder, 'secret.json');
    writeFileSync(file, JSON.stringify({ url, ca }), { mode: 0o600 });
    try {
      aws([
        'secretsmanager',
        'put-secret-value',
        '--secret-id',
        BACKUP_SECRET,
        '--secret-string',
        `file://${file}`,
        '--query',
        'VersionId',
      ]);
    } catch {
      throw new Error(
        'app_backup has a new password, but the secret was not written. Run the script again; until then each copy fails.',
      );
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  console.log(
    `RESULT: app_backup has a new password (it reads ${String(tables)} tables), and ${BACKUP_SECRET} holds its address.`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(`RESULT: stopped. ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
