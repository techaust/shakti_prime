import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The production backup stack (infra/aws/backups.yaml, docs/05-database.md §10), checked for its
// shape without any AWS call. The template is YAML in its JSON form, so JSON reads it.

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

const template = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../infra/aws/backups.yaml', import.meta.url)), 'utf8'),
) as {
  Parameters: Record<string, { AllowedValues?: string[]; Default?: string }>;
  Resources: Record<string, Resource>;
};

function resource(name: string, type: string): Record<string, unknown> {
  const found = template.Resources[name];
  expect(found?.Type).toBe(type);
  return found?.Properties ?? {};
}

const statements = (document: unknown) => (document as { Statement: Statement[] }).Statement;
const actions = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);

describe('the production backup template', () => {
  const bucket = resource('BackupBucket', 'AWS::S3::Bucket');

  it('serves production alone, and keeps its bucket and key when the stack goes', () => {
    expect(template.Parameters.EnvironmentName?.AllowedValues).toEqual(['production']);
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

  it("lets only the backup job of the repository's backup environment take the role", () => {
    const role = resource('BackupWriterRole', 'AWS::IAM::Role');
    const [trust, ...more] = statements(role.AssumeRolePolicyDocument);
    expect(more).toEqual([]);
    expect(trust?.Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(trust?.Condition).toEqual({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
        'token.actions.githubusercontent.com:sub': {
          'Fn::Sub': 'repo:${GitHubRepository}:environment:${GitHubEnvironment}',
        },
      },
    });
    expect(template.Parameters.GitHubRepository?.Default).toBe('techaust/shakti_prime');
    expect(template.Parameters.GitHubEnvironment?.Default).toBe('production-backup');
    expect(template.Resources.GitHubOidcProvider?.Condition).toBe('MakesOidcProvider');
  });

  it('lets the role add a copy and nothing more: no reading, listing, deleting or unlocking', () => {
    const role = resource('BackupWriterRole', 'AWS::IAM::Role');
    const policies = role.Policies as { PolicyDocument: unknown }[];
    const granted = policies.flatMap((p) => statements(p.PolicyDocument));
    expect(granted.every((s) => s.Effect === 'Allow')).toBe(true);
    expect(granted.flatMap(actions).sort()).toEqual([
      'kms:Decrypt',
      'kms:GenerateDataKey',
      's3:PutObject',
    ]);
    expect(granted.find((s) => actions(s).includes('s3:PutObject'))?.Resource).toEqual({
      'Fn::Sub': '${BackupBucket.Arn}/backups/*',
    });
    // The key is used only through S3.
    expect(granted.find((s) => actions(s).includes('kms:Decrypt'))?.Condition).toEqual({
      StringEquals: { 'kms:ViaService': { 'Fn::Sub': 's3.${AWS::Region}.amazonaws.com' } },
    });
  });

  it('lets the read-only user list the copies and read the settings, never a copy', () => {
    const policy = resource('ReadOnlyBackupPolicy', 'AWS::IAM::Policy');
    const granted = statements(policy.PolicyDocument).flatMap(actions);
    expect(granted).toContain('s3:ListBucket');
    expect(granted.some((a) => a.startsWith('s3:GetObject') || a.startsWith('kms:'))).toBe(false);
  });
});
