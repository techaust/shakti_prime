import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOUND_AMZ_HEADERS } from './s3-store';

// The file storage stack (infra/aws/files.yaml, docs/runbooks/files-setup.md), checked for its
// shape without any AWS call. The template is YAML in its JSON form, so JSON reads it.

interface Statement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Principal?: unknown;
  Condition?: Record<string, Record<string, unknown>>;
}
interface Resource {
  Type: string;
  DeletionPolicy?: string;
  DependsOn?: string[];
  Properties: Record<string, unknown>;
}
interface Template {
  Parameters: Record<string, { AllowedValues?: string[]; Default?: string }>;
  Resources: Record<string, Resource>;
  Outputs: Record<string, { Value: unknown }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const template = JSON.parse(
  readFileSync(join(here, '../../../../infra/aws/files.yaml'), 'utf8'),
) as Template;

function resource(name: string, type: string): Record<string, unknown> {
  const found = template.Resources[name];
  expect(found?.Type).toBe(type);
  return found?.Properties ?? {};
}

function statements(document: unknown): Statement[] {
  return (document as { Statement: Statement[] }).Statement;
}

function actionsOf(statement: Statement): string[] {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

const bucket = resource('FilesBucket', 'AWS::S3::Bucket');
const OBJECTS = { 'Fn::Sub': '${FilesBucket.Arn}/*' };
const BUCKET = { 'Fn::GetAtt': ['FilesBucket', 'Arn'] };

describe('the file storage template', () => {
  it('makes one stack per environment, dev or staging', () => {
    expect(template.Parameters.EnvironmentName?.AllowedValues).toEqual(['dev', 'staging']);
    expect(bucket.BucketName).toEqual({ 'Fn::Sub': 'shakti-prime-${EnvironmentName}-files' });
    expect(template.Resources.FilesBucket?.DeletionPolicy).toBe('Retain');
  });

  it('keeps the bucket private, owned by the account, versioned and encrypted with the key', () => {
    expect(bucket.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(bucket.OwnershipControls).toEqual({
      Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
    });
    expect(bucket.VersioningConfiguration).toEqual({ Status: 'Enabled' });
    expect(bucket.BucketEncryption).toEqual({
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: 'aws:kms',
            KMSMasterKeyID: { 'Fn::GetAtt': ['FilesKey', 'Arn'] },
          },
          BucketKeyEnabled: true,
        },
      ],
    });
  });

  it('refuses every call that is not over TLS', () => {
    const policy = resource('FilesBucketPolicy', 'AWS::S3::BucketPolicy');
    expect(statements(policy.PolicyDocument)).toContainEqual({
      Sid: 'TlsOnly',
      Effect: 'Deny',
      Principal: '*',
      Action: 's3:*',
      Resource: [BUCKET, OBJECTS],
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    });
  });

  it('lets the environment’s own site upload and download with exactly the headers the store signs', () => {
    const [rule] = (bucket.CorsConfiguration as { CorsRules: Record<string, unknown>[] }).CorsRules;
    expect(rule?.AllowedMethods).toEqual(['PUT', 'GET']);
    expect(rule?.AllowedOrigins).toEqual([
      { 'Fn::Sub': 'https://shakti-prime-${EnvironmentName}.vercel.app' },
    ]);
    expect([...((rule?.AllowedHeaders as string[] | undefined) ?? [])].sort()).toEqual(
      ['content-type', ...BOUND_AMZ_HEADERS].sort(),
    );
  });

  it('abandons an unfinished upload, and drops earlier versions and bare delete markers, after a day', () => {
    expect(bucket.LifecycleConfiguration).toEqual({
      Rules: [
        {
          Id: 'abort-incomplete-uploads',
          Status: 'Enabled',
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
        },
        {
          Id: 'expire-earlier-versions',
          Status: 'Enabled',
          NoncurrentVersionExpiration: { NoncurrentDays: 1 },
          ExpiredObjectDeleteMarker: true,
        },
      ],
    });
  });

  it('rotates the environment’s key', () => {
    const key = resource('FilesKey', 'AWS::KMS::Key');
    expect(key.EnableKeyRotation).toBe(true);
    expect(resource('FilesKeyAlias', 'AWS::KMS::Alias').AliasName).toEqual({
      'Fn::Sub': 'alias/shakti-prime-${EnvironmentName}-files',
    });
  });

  it('turns on the malware scan with its verdict written as a tag', () => {
    const plan = resource('MalwareProtectionPlan', 'AWS::GuardDuty::MalwareProtectionPlan');
    expect(plan.ProtectedResource).toEqual({ S3Bucket: { BucketName: { Ref: 'FilesBucket' } } });
    expect(plan.Actions).toEqual({ Tagging: { Status: 'ENABLED' } });
    expect(plan.Role).toEqual({ 'Fn::GetAtt': ['MalwareScanRole', 'Arn'] });
    const role = resource('MalwareScanRole', 'AWS::IAM::Role');
    expect(statements(role.AssumeRolePolicyDocument)).toEqual([
      {
        Effect: 'Allow',
        Principal: { Service: 'malware-protection-plan.guardduty.amazonaws.com' },
        Action: 'sts:AssumeRole',
        Condition: { StringEquals: { 'aws:SourceAccount': { 'Fn::Sub': '${AWS::AccountId}' } } },
      },
    ]);
    const granted = (role.Policies as { PolicyDocument: unknown }[]).flatMap((p) =>
      statements(p.PolicyDocument).flatMap(actionsOf),
    );
    for (const action of ['s3:PutObjectTagging', 's3:GetObject', 'kms:Decrypt', 'events:PutRule']) {
      expect(granted).toContain(action);
    }
  });

  it('gives the app user the bucket’s objects, the key and mail from the one sender, nothing more', () => {
    const user = resource('AppUser', 'AWS::IAM::User');
    expect(user.UserName).toEqual({ 'Fn::Sub': 'shakti-prime-${EnvironmentName}-app' });
    const [policy] = user.Policies as { PolicyDocument: unknown }[];
    const all = statements(policy?.PolicyDocument);
    const plain = all.filter((s) => !('Fn::If' in s));
    expect(plain.map((s) => [s.Sid, actionsOf(s), s.Resource])).toEqual([
      [
        'FileObjects',
        [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:DeleteObjectVersion',
          's3:GetObjectTagging',
        ],
        [OBJECTS],
      ],
      ['FileVersions', ['s3:ListBucketVersions'], [BUCKET]],
      [
        'EnvironmentKey',
        ['kms:Decrypt', 'kms:GenerateDataKey'],
        { 'Fn::GetAtt': ['FilesKey', 'Arn'] },
      ],
    ]);
    const mail = all.find((s) => 'Fn::If' in s) as unknown as {
      'Fn::If': [string, Statement, unknown];
    };
    const [condition, sender] = mail['Fn::If'];
    expect(condition).toBe('HasSes');
    expect(actionsOf(sender)).toEqual(['ses:SendEmail']);
    expect(sender.Condition).toEqual({
      StringEquals: { 'ses:FromAddress': { Ref: 'SesFromAddress' } },
    });
    for (const s of [...plain, sender]) expect(s.Effect).toBe('Allow');
  });

  it('lets the read-only user list the bucket and read its settings, never an object', () => {
    const policy = resource('ReadOnlyBucketPolicy', 'AWS::IAM::Policy');
    expect(policy.Users).toEqual([{ Ref: 'ReadOnlyUserName' }]);
    expect(template.Parameters.ReadOnlyUserName?.Default).toBe('claude-shakti');
    for (const s of statements(policy.PolicyDocument)) {
      expect(s.Resource).toEqual([BUCKET]);
      for (const action of actionsOf(s)) {
        expect(action).not.toMatch(/Object|^s3:\*$/);
      }
      expect(actionsOf(s)).toContain('s3:ListBucket');
    }
  });

  it('names the values Vercel needs, never a secret', () => {
    expect(Object.keys(template.Outputs).sort()).toEqual([
      'AppUserName',
      'FilesBucket',
      'FilesKmsKeyId',
    ]);
    expect(JSON.stringify(template)).not.toMatch(/AccessKey|SecretAccessKey/);
  });
});
