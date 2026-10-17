import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The production backup stack (infra/aws/backups.yaml, docs/05-database.md §10), checked for its
// shape without any AWS call, and its copy script run under bash with stand-ins for the database
// and AWS commands. The template is YAML in its JSON form, so JSON reads it.

interface Resource {
  Type: string;
  Condition?: string;
  DeletionPolicy?: string;
  Properties: Record<string, unknown>;
}
interface Statement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Principal?: unknown;
  Condition?: Record<string, Record<string, unknown>>;
}

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string): string => readFileSync(`${root}${path}`, 'utf8');
const template = JSON.parse(read('infra/aws/backups.yaml')) as {
  Parameters: Record<string, { AllowedValues?: string[]; Default?: string }>;
  Resources: Record<string, Resource>;
};
const PRODUCTION_REF = 'ifnoytyhnedgiyhxxhhu';

function resource(name: string, type: string): Record<string, unknown> {
  const found = template.Resources[name];
  expect(found?.Type).toBe(type);
  return found?.Properties ?? {};
}

const statements = (document: unknown) => (document as { Statement: Statement[] }).Statement;
const actions = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);
const granted = (role: Record<string, unknown>) =>
  (role.Policies as { PolicyDocument: unknown }[]).flatMap((p) => statements(p.PolicyDocument));

const project = resource('BackupProject', 'AWS::CodeBuild::Project');
const environment = project.Environment as {
  PrivilegedMode: boolean;
  EnvironmentVariables: { Name: string; Type: string; Value: unknown }[];
};
const variable = (name: string) => environment.EnvironmentVariables.find((v) => v.Name === name);
const buildspec = (project.Source as { BuildSpec: string }).BuildSpec;

/** The build phase's one command: the `- |` block under `build:`, without its indentation. */
function copyScript(): string {
  const lines = buildspec.split('\n');
  const start = lines.indexOf('  build:');
  const block = lines.findIndex((line, i) => i > start && line.trim() === '- |');
  expect(start).toBeGreaterThan(0);
  const body: string[] = [];
  for (const line of lines.slice(block + 1)) {
    if (line.trim() !== '' && !line.startsWith('        ')) break;
    body.push(line.slice(8));
  }
  return body.join('\n');
}

describe('the production backup template', () => {
  const bucket = resource('BackupBucket', 'AWS::S3::Bucket');

  it('serves production alone, and keeps its bucket and key when the stack goes', () => {
    expect(template.Parameters.EnvironmentName?.AllowedValues).toEqual(['production']);
    expect(template.Parameters.ProjectRef?.Default).toBe(PRODUCTION_REF);
    expect(bucket.BucketName).toEqual({ 'Fn::Sub': 'shakti-prime-${EnvironmentName}-backups' });
    expect(template.Resources.BackupBucket?.DeletionPolicy).toBe('Retain');
    expect(template.Resources.BackupKey?.DeletionPolicy).toBe('Retain');
    expect(resource('BackupKey', 'AWS::KMS::Key').EnableKeyRotation).toBe(true);
  });

  it('keeps every copy private, encrypted with its own key and locked for 30 days, then removes it', () => {
    expect(bucket.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(bucket.BucketEncryption).toEqual({
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: 'aws:kms',
            KMSMasterKeyID: { 'Fn::GetAtt': ['BackupKey', 'Arn'] },
          },
          BucketKeyEnabled: true,
        },
      ],
    });
    expect(bucket.ObjectLockEnabled).toBe(true);
    expect(bucket.ObjectLockConfiguration).toEqual({
      ObjectLockEnabled: 'Enabled',
      Rule: { DefaultRetention: { Mode: 'GOVERNANCE', Days: 30 } },
    });
    const rules = (bucket.LifecycleConfiguration as { Rules: Record<string, unknown>[] }).Rules;
    expect(rules.find((r) => r.Id === 'remove-after-30-days')).toMatchObject({
      ExpirationInDays: 31,
      NoncurrentVersionExpiration: { NoncurrentDays: 1 },
    });
    const policy = resource('BackupBucketPolicy', 'AWS::S3::BucketPolicy');
    expect(statements(policy.PolicyDocument)).toContainEqual(
      expect.objectContaining({ Sid: 'TlsOnly', Effect: 'Deny', Action: 's3:*' }),
    );
  });

  it('leaves GitHub no way in: no token trust, and no workflow that copies the database', () => {
    const text = JSON.stringify(template);
    expect(text).not.toContain('token.actions.githubusercontent.com');
    expect(text).not.toContain('AssumeRoleWithWebIdentity');
    expect(Object.keys(template.Parameters).filter((p) => p.startsWith('GitHub'))).toEqual([]);
    expect(existsSync(`${root}.github/workflows/backup.yml`)).toBe(false);
    for (const file of readdirSync(`${root}.github/workflows`)) {
      const workflow = read(`.github/workflows/${file}`);
      expect(workflow).not.toContain('production-backup');
      expect(workflow).not.toContain('DATABASE_URL_BACKUP');
      expect(workflow).not.toContain('pg_dump');
    }
  });

  it('lets only the backup project take its role', () => {
    const role = resource('BackupRunnerRole', 'AWS::IAM::Role');
    const [trust, ...more] = statements(role.AssumeRolePolicyDocument);
    expect(more).toEqual([]);
    expect(trust).toMatchObject({
      Effect: 'Allow',
      Principal: { Service: 'codebuild.amazonaws.com' },
      Action: 'sts:AssumeRole',
    });
    expect(trust?.Condition).toEqual({
      StringEquals: { 'aws:SourceAccount': { Ref: 'AWS::AccountId' } },
      ArnEquals: {
        'aws:SourceArn': {
          'Fn::Sub':
            'arn:aws:codebuild:${AWS::Region}:${AWS::AccountId}:project/shakti-prime-${EnvironmentName}-backup',
        },
      },
    });
    expect(project.Name).toEqual({ 'Fn::Sub': 'shakti-prime-${EnvironmentName}-backup' });
    expect(project.ServiceRole).toEqual({ 'Fn::GetAtt': ['BackupRunnerRole', 'Arn'] });
  });

  it('lets the role read its one secret, add a copy and write its log, and nothing more', () => {
    const allowed = granted(resource('BackupRunnerRole', 'AWS::IAM::Role'));
    expect(allowed.every((s) => s.Effect === 'Allow')).toBe(true);
    expect(allowed.flatMap(actions).sort()).toEqual([
      'kms:Decrypt',
      'kms:GenerateDataKey',
      'logs:CreateLogStream',
      'logs:PutLogEvents',
      's3:PutObject',
      'secretsmanager:GetSecretValue',
    ]);
    const statement = (action: string) => allowed.find((s) => actions(s).includes(action));
    expect(statement('secretsmanager:GetSecretValue')?.Resource).toEqual({
      Ref: 'BackupDatabaseSecret',
    });
    expect(statement('s3:PutObject')?.Resource).toEqual({
      'Fn::Sub': '${BackupBucket.Arn}/backups/${EnvironmentName}/*',
    });
    expect(statement('logs:PutLogEvents')?.Resource).toEqual({
      'Fn::Sub': '${BackupLogGroup.Arn}',
    });
    // The key is used only through S3 and Secrets Manager.
    expect(statement('kms:Decrypt')?.Condition).toEqual({
      StringEquals: {
        'kms:ViaService': [
          { 'Fn::Sub': 's3.${AWS::Region}.amazonaws.com' },
          { 'Fn::Sub': 'secretsmanager.${AWS::Region}.amazonaws.com' },
        ],
      },
    });
  });

  it('keeps the address in a secret of its own key, which only the backup may read', () => {
    const secret = resource('BackupDatabaseSecret', 'AWS::SecretsManager::Secret');
    expect(secret.KmsKeyId).toEqual({ 'Fn::GetAtt': ['BackupKey', 'Arn'] });
    // Created empty: the value never passes through the template or the stack's parameters.
    expect(secret).not.toHaveProperty('SecretString');
    expect(secret).not.toHaveProperty('GenerateSecretString');
    const policy = resource('BackupDatabaseSecretPolicy', 'AWS::SecretsManager::ResourcePolicy');
    expect(policy.SecretId).toEqual({ Ref: 'BackupDatabaseSecret' });
    expect(statements(policy.ResourcePolicy)).toEqual([
      expect.objectContaining({
        Effect: 'Deny',
        Principal: '*',
        Action: 'secretsmanager:GetSecretValue',
        Condition: {
          ArnNotEquals: { 'aws:PrincipalArn': { 'Fn::GetAtt': ['BackupRunnerRole', 'Arn'] } },
        },
      }),
    ]);
    expect(variable('DATABASE_URL_BACKUP')).toEqual({
      Name: 'DATABASE_URL_BACKUP',
      Type: 'SECRETS_MANAGER',
      Value: { 'Fn::Sub': '${BackupDatabaseSecret}:url' },
    });
    expect(variable('DATABASE_CA_CERT')).toEqual({
      Name: 'DATABASE_CA_CERT',
      Type: 'SECRETS_MANAGER',
      Value: { 'Fn::Sub': '${BackupDatabaseSecret}:ca' },
    });
    // Nothing else in the project's settings is secret.
    const plain = environment.EnvironmentVariables.filter((v) => v.Type !== 'SECRETS_MANAGER');
    expect(plain.every((v) => v.Type === 'PLAINTEXT')).toBe(true);
    expect(plain.map((v) => v.Name).sort()).toEqual([
      'BACKUP_BUCKET',
      'ENVIRONMENT_NAME',
      'PROJECT_REF',
      'SCHEMAS',
    ]);
  });

  it('runs one copy at a time, every 6 hours, from no source, unprivileged, logging to its own group', () => {
    expect(project.Source).toMatchObject({ Type: 'NO_SOURCE' });
    expect(project.Artifacts).toEqual({ Type: 'NO_ARTIFACTS' });
    expect(environment.PrivilegedMode).toBe(false);
    expect(project.ConcurrentBuildLimit).toBe(1);
    expect(project.TimeoutInMinutes).toBe(60);
    expect(project.LogsConfig).toEqual({
      CloudWatchLogs: { Status: 'ENABLED', GroupName: { Ref: 'BackupLogGroup' } },
      S3Logs: { Status: 'DISABLED' },
    });
    const schedule = resource('BackupSchedule', 'AWS::Events::Rule');
    expect(schedule.ScheduleExpression).toBe('cron(23 0/6 * * ? *)');
    expect(schedule.State).toBe('ENABLED');
    expect(schedule.Targets).toEqual([
      {
        Id: 'backup',
        Arn: { 'Fn::GetAtt': ['BackupProject', 'Arn'] },
        RoleArn: { 'Fn::GetAtt': ['BackupScheduleRole', 'Arn'] },
      },
    ]);
    const starter = granted(resource('BackupScheduleRole', 'AWS::IAM::Role'));
    expect(starter.flatMap(actions)).toEqual(['codebuild:StartBuild']);
    expect(starter[0]?.Resource).toEqual({ 'Fn::GetAtt': ['BackupProject', 'Arn'] });
  });

  it('copies exactly the schemas the backup login is granted', () => {
    const schemas = String(variable('SCHEMAS')?.Value).split(' ');
    expect(schemas.length).toBeGreaterThan(3);
    // Found by its name, not its number, which moves when main gains migrations first.
    const migration = readdirSync(`${root}packages/db/migrations`).find((f) =>
      f.endsWith('_backup_role.sql'),
    );
    const grants = read(`packages/db/migrations/${migration ?? 'none'}`)
      .split('\n')
      .filter((l) => / in schema | on schema /.test(l));
    expect(grants.length).toBeGreaterThan(0);
    for (const line of grants) expect(line).toContain(schemas.join(', '));
  });

  it("lets the app list the copies' names and times, and the read-only user never read one", () => {
    const app = resource('AppListsCopiesPolicy', 'AWS::IAM::Policy');
    expect(app.Users).toEqual([{ Ref: 'AppUserName' }]);
    expect(statements(app.PolicyDocument)).toEqual([
      expect.objectContaining({
        Effect: 'Allow',
        Action: 's3:ListBucket',
        Resource: { 'Fn::GetAtt': ['BackupBucket', 'Arn'] },
        Condition: { StringLike: { 's3:prefix': { 'Fn::Sub': 'backups/${EnvironmentName}/*' } } },
      }),
    ]);
    expect(template.Parameters.AppUserName?.Default).toBe('shakti-prime-production-app');
    const readOnly = statements(
      resource('ReadOnlyBackupPolicy', 'AWS::IAM::Policy').PolicyDocument,
    ).flatMap(actions);
    expect(readOnly).toContain('s3:ListBucket');
    expect(readOnly).toContain('codebuild:BatchGetBuilds');
    expect(
      readOnly.filter(
        (a) => a.startsWith('s3:GetObject') || a.startsWith('kms:') || a.includes('GetSecretValue'),
      ),
    ).toEqual([]);
  });
});

/**
 * Stand-ins for the database and AWS commands, as shell functions ahead of the script: `psql`
 * prints how many tables app_backup may read (`FAKE_EXPECTED`), `pg_dump` writes a small file,
 * `pg_restore --list` lists `FAKE_TABLES` tables' data, and `aws` records its arguments in
 * `FAKE_AWS` and answers a version id.
 */
const FAKES = [
  `psql() { cat > /dev/null; printf '%s\\n' "$FAKE_EXPECTED"; }`,
  'pg_dump() { for a in "$@"; do case "$a" in --file=*) printf copy > "${a#--file=}" ;; esac; done; }',
  `pg_restore() { for i in $(seq 1 "$FAKE_TABLES"); do echo "1; 0 0 TABLE DATA public t$i postgres"; done; }`,
  `aws() { printf '%s\\n' "$*" > "$FAKE_AWS"; echo 3HL4kqtJlcpXroDTDmJ.rmSpXd3dIbrHY; }`,
].join('\n');

describe('the copy script', () => {
  const script = `${FAKES}\n${copyScript()}`;
  const url = `postgresql://app_backup.${PRODUCTION_REF}:value@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`;

  function copy(change: Record<string, string>): {
    status: number | null;
    stdout: string;
    aws: string;
  } {
    const folder = mkdtempSync(join(tmpdir(), 'backup-'));
    try {
      const recorded = join(folder, 'aws').replaceAll('\\', '/');
      const env: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        ENVIRONMENT_NAME: 'production',
        PROJECT_REF: PRODUCTION_REF,
        BACKUP_BUCKET: 'shakti-prime-production-backups',
        SCHEMAS: 'public app audit_archive audit_partitions crm_partitions drizzle',
        CODEBUILD_BUILD_NUMBER: '17',
        DATABASE_URL_BACKUP: url,
        DATABASE_CA_CERT: 'certificate',
        FAKE_EXPECTED: '120',
        FAKE_TABLES: '120',
        FAKE_AWS: recorded,
        ...change,
      };
      const result = spawnSync('bash', ['-c', script], {
        env: env as NodeJS.ProcessEnv,
        encoding: 'utf8',
      });
      const aws = existsSync(recorded) ? readFileSync(recorded, 'utf8') : '';
      return { status: result.status, stdout: result.stdout, aws };
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }

  it('keeps a copy that holds every table app_backup may read, with its SHA-256 and version', () => {
    const kept = copy({});
    expect(kept.status).toBe(0);
    // The SHA-256 of the stand-in's copy, "copy".
    const sha = createHash('sha256').update('copy').digest('hex');
    expect(kept.stdout).toMatch(
      /^Kept backups\/production\/\d{4}\/\d{2}\/\d{2}\/\d{8}T\d{6}Z-17\.dump, version 3HL4kqtJlcpXroDTDmJ\.rmSpXd3dIbrHY \(SHA-256 [0-9a-f]{64}\), the data of 120 tables/m,
    );
    expect(kept.stdout).toContain(`(SHA-256 ${sha})`);
    expect(kept.aws).toContain('s3api put-object --bucket shakti-prime-production-backups');
    expect(kept.aws).toContain('--checksum-algorithm SHA256');
    expect(kept.aws).toContain(`--metadata sha256=${sha}`);
  });

  it('refuses an address that is not the backup login on the production project', () => {
    for (const address of [
      '',
      `postgresql://postgres.${PRODUCTION_REF}:value@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
      'postgresql://app_backup.azydxxvlboivablvvojp:value@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
      `postgresql://app_backup:value@db.${PRODUCTION_REF}.supabase.co:5432/postgres`,
    ]) {
      const refused = copy({ DATABASE_URL_BACKUP: address });
      expect(refused.status).toBe(1);
      expect(refused.aws).toBe('');
    }
    expect(copy({ DATABASE_CA_CERT: '' }).status).toBe(1);
  });

  it('refuses an address that carries a setting of its own, which would loosen the TLS check', () => {
    for (const address of [
      `${url}?sslmode=require`,
      `postgresql://app_backup.${PRODUCTION_REF}:value?sslmode=disable@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
      `postgresql://app_backup.${PRODUCTION_REF}:sslrootcert=x@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`,
    ]) {
      const refused = copy({ DATABASE_URL_BACKUP: address });
      expect(refused.status).toBe(1);
      expect(refused.aws).toBe('');
    }
    expect(copyScript()).toContain('export PGSSLMODE=verify-full PGSSLROOTCERT=');
  });

  it('keeps no copy missing a table app_backup may read, nor one when it reads too few', () => {
    const short = copy({ FAKE_TABLES: '119' });
    expect(short.status).toBe(1);
    expect(short.stdout).toContain(
      'The copy holds the data of 119 tables; app_backup may read 120',
    );
    expect(short.aws).toBe('');
    for (const expected of ['49', '', 'ERROR']) {
      const refused = copy({ FAKE_EXPECTED: expected, FAKE_TABLES: '200' });
      expect(refused.status).toBe(1);
      expect(refused.aws).toBe('');
    }
    // A table added while the copy ran is in the copy too.
    expect(copy({ FAKE_TABLES: '121' }).status).toBe(0);
  });
});
