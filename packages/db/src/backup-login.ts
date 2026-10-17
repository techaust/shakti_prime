// Gives production's backup login, app_backup, a new password and puts its address in AWS Secrets
// Manager, where only the backup's CodeBuild project reads it (docs/runbooks/deploy.md §1 step 4,
// §5; docs/05-database.md §10). The owner runs it through tools/secrets/set-backup-login.ps1, with
// the production database password typed into a hidden prompt and the AWS command line signed in
// as the account's administrator. Node 24 runs this file as it is, so it imports only Node's own
// modules and `postgres`.
//
// The password is made here and never shown. The database receives only its SCRAM verifier, which
// can check a password but not sign in, so the statement in the server's log holds nothing usable,
// and GitHub never holds the password at all. The address that holds it goes from this process's
// memory to Secrets Manager in one request this file signs itself (AWS Signature Version 4), so it
// is never written to a file, and no child process receives it or the database password.
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

/** The signed-in session's keys, as the AWS command line exports them. */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** A request to sign: `query` is already in its canonical form (names sorted, values encoded). */
export interface AwsRequest {
  method: 'GET' | 'POST';
  host: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  body: string;
}

const sha256Hex = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * Signs a request with AWS Signature Version 4: answers its headers, named in lower case, with
 * `host`, `x-amz-date`, the session token when there is one, and `authorization` added.
 */
export function signV4(
  request: AwsRequest,
  credentials: AwsCredentials,
  region: string,
  service: string,
  now: Date = new Date(),
): Record<string, string> {
  const amzDate = now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) headers[name.toLowerCase()] = value;
  headers.host = request.host;
  headers['x-amz-date'] = amzDate;
  if (credentials.sessionToken !== undefined) {
    headers['x-amz-security-token'] = credentials.sessionToken;
  }
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonical = [
    request.method,
    request.path,
    request.query,
    names.map((name) => `${name}:${(headers[name] ?? '').trim().replace(/\s+/g, ' ')}\n`).join(''),
    signedHeaders,
    sha256Hex(request.body),
  ].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

/**
 * Reads what `aws configure export-credentials --format process` prints. A message never quotes
 * it, since it holds the session's secret key.
 */
export function parseExportedCredentials(output: string): AwsCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = undefined;
  }
  const value = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >;
  const { AccessKeyId, SecretAccessKey, SessionToken } = value;
  if (
    value.Version !== 1 ||
    typeof AccessKeyId !== 'string' ||
    AccessKeyId === '' ||
    typeof SecretAccessKey !== 'string' ||
    SecretAccessKey === ''
  ) {
    throw new Error(
      'the AWS command line gave no credentials: sign in with aws login and run the script again',
    );
  }
  return typeof SessionToken === 'string' && SessionToken !== ''
    ? { accessKeyId: AccessKeyId, secretAccessKey: SecretAccessKey, sessionToken: SessionToken }
    : { accessKeyId: AccessKeyId, secretAccessKey: SecretAccessKey };
}

/**
 * Puts the backup secret's new value with Secrets Manager's PutSecretValue, signed here, so the
 * value goes from memory straight to HTTPS. Answers the new version's id.
 */
export async function putBackupSecret(
  secretString: string,
  credentials: AwsCredentials,
  send: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<string> {
  const host = `secretsmanager.${AWS_REGION}.amazonaws.com`;
  const body = JSON.stringify({
    SecretId: BACKUP_SECRET,
    SecretString: secretString,
    ClientRequestToken: randomUUID(),
  });
  const signed = signV4(
    {
      method: 'POST',
      host,
      path: '/',
      query: '',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'secretsmanager.PutSecretValue',
      },
      body,
    },
    credentials,
    AWS_REGION,
    'secretsmanager',
    now,
  );
  // fetch sends the host of the address itself, the one signed.
  const headers = Object.fromEntries(Object.entries(signed).filter(([name]) => name !== 'host'));
  const response = await send(`https://${host}/`, { method: 'POST', headers, body });
  const answer = (await response.json().catch(() => ({}))) as {
    VersionId?: unknown;
    __type?: unknown;
  };
  if (!response.ok || typeof answer.VersionId !== 'string') {
    // AWS's error kind (for example AccessDeniedException) carries no part of the value sent.
    const kind =
      typeof answer.__type === 'string' ? `, ${answer.__type.split('#').pop() ?? ''}` : '';
    throw new Error(`Secrets Manager refused the new value (${String(response.status)}${kind})`);
  }
  return answer.VersionId;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

/** Reads a secret from the environment and removes it there, so no child process inherits it. */
export function takeSecret(name: string): string {
  const value = required(name);
  Reflect.deleteProperty(process.env, name);
  return value;
}

function aws(args: string[]): string {
  return execFileSync('aws', [...args, '--region', AWS_REGION, '--output', 'text'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

/** The AWS command line's credentials, read through a pipe and kept in memory only. */
function awsCredentials(): AwsCredentials {
  return parseExportedCredentials(
    execFileSync('aws', ['configure', 'export-credentials', '--format', 'process'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  );
}

async function main(): Promise<void> {
  const databasePassword = takeSecret('PRODUCTION_DATABASE_PASSWORD');
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
  const credentials = awsCredentials();

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

  try {
    await putBackupSecret(JSON.stringify({ url, ca }), credentials);
  } catch (error) {
    const reason = error instanceof Error ? ` (${error.message})` : '';
    throw new Error(
      `app_backup has a new password, but the secret was not written${reason}. Run the script again; until then each copy fails.`,
    );
  }
  process.stdout.write(
    `RESULT: app_backup has a new password (it reads ${String(tables)} tables), and ${BACKUP_SECRET} holds its address.\n`,
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
