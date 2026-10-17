import { spawnSync } from 'node:child_process';
import type * as Fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// The backup login script's one call to Secrets Manager (L15): signed here with AWS Signature
// Version 4, so the address that holds the password goes from memory to HTTPS and never to a file.

/** Every call this file's script makes to a function of Node's that writes to the disk. */
const writes = vi.hoisted(() => [] as string[]);
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof Fs>();
  const watched = (name: string) =>
    ((...args: unknown[]) => {
      writes.push(name);
      return (fs[name as keyof typeof fs] as (...a: unknown[]) => unknown)(...args);
    }) as never;
  const writers = {
    writeFileSync: watched('writeFileSync'),
    appendFileSync: watched('appendFileSync'),
    mkdtempSync: watched('mkdtempSync'),
    openSync: watched('openSync'),
    createWriteStream: watched('createWriteStream'),
    writeFile: watched('writeFile'),
    mkdtemp: watched('mkdtemp'),
  };
  return { ...fs, ...writers, default: { ...fs, ...writers } };
});

const { BACKUP_SECRET, parseExportedCredentials, putBackupSecret, signV4, takeSecret } =
  await import('./backup-login');

// AWS's documented example keys (the Signature Version 4 test suite), in parts so that no secret
// scanner reads them as a live key.
const VECTOR = ['AKIDEXAMPLE', ['wJalrXUtnFEMI', 'K7MDENG+bPxRfiCYEXAMPLEKEY'].join('/')] as const;
const vectorKeys = { accessKeyId: VECTOR[0], secretAccessKey: VECTOR[1] };
const vectorTime = new Date('2015-08-30T12:36:00Z');

describe('AWS Signature Version 4', () => {
  it("signs AWS's get-vanilla test vector", () => {
    const headers = signV4(
      { method: 'GET', host: 'example.amazonaws.com', path: '/', query: '', headers: {}, body: '' },
      vectorKeys,
      'us-east-1',
      'service',
      vectorTime,
    );
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  it("signs AWS's documented IAM ListUsers example, with a query and a content type", () => {
    const headers = signV4(
      {
        method: 'GET',
        host: 'iam.amazonaws.com',
        path: '/',
        query: 'Action=ListUsers&Version=2010-05-08',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
        body: '',
      },
      vectorKeys,
      'us-east-1',
      'iam',
      vectorTime,
    );
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });

  it("signs a Secrets Manager call with a session's token as AWS's own signer does", () => {
    // The value AWS's JavaScript signer (@smithy/signature-v4) gives for the same request.
    const headers = signV4(
      {
        method: 'POST',
        host: 'secretsmanager.ap-south-1.amazonaws.com',
        path: '/',
        query: '',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'secretsmanager.PutSecretValue',
        },
        body: '{"SecretId":"x","SecretString":"y"}',
      },
      { ...vectorKeys, sessionToken: 'session-value' },
      'ap-south-1',
      'secretsmanager',
      vectorTime,
    );
    expect(headers['x-amz-security-token']).toBe('session-value');
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/ap-south-1/secretsmanager/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token;x-amz-target, Signature=973ef22f26a3c3a943e58f2ae92751bfadea04a05bf04d1b9afed1dbb4c52161',
    );
  });
});

describe("the backup secret's new value", () => {
  const value = JSON.stringify({
    url: 'postgresql://app_backup.ref:the-new-login-phrase@aws-1-ap-south-1.pooler.supabase.com:5432/postgres',
    ca: 'certificate',
  });
  const keys = { ...vectorKeys, sessionToken: 'session-value' };

  it('goes in one signed request to Secrets Manager in Mumbai, and to no file', async () => {
    writes.length = 0;
    const calls: { url: string; init: RequestInit }[] = [];
    const send = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(
        Response.json({ ARN: 'arn', Name: BACKUP_SECRET, VersionId: 'version-1' }),
      );
    }) as typeof fetch;

    await expect(putBackupSecret(value, keys, send, vectorTime)).resolves.toBe('version-1');
    expect(writes).toEqual([]);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://secretsmanager.ap-south-1.amazonaws.com/');
    const body = call?.init.body as string;
    const sent = JSON.parse(body) as Record<string, string>;
    expect(sent.SecretId).toBe(BACKUP_SECRET);
    expect(sent.SecretString).toBe(value);
    expect(sent.ClientRequestToken).toMatch(/^[0-9a-f-]{36}$/);
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.host).toBeUndefined();
    expect(headers['x-amz-target']).toBe('secretsmanager.PutSecretValue');
    // The signature covers exactly the body sent.
    const expected = signV4(
      {
        method: 'POST',
        host: 'secretsmanager.ap-south-1.amazonaws.com',
        path: '/',
        query: '',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'secretsmanager.PutSecretValue',
        },
        body,
      },
      keys,
      'ap-south-1',
      'secretsmanager',
      vectorTime,
    );
    expect(headers.authorization).toBe(expected.authorization);
    expect(Object.values(headers).join(' ')).not.toContain('the-new-login-phrase');
  });

  it("stops on AWS's refusal with its kind, and never repeats the value", async () => {
    const send = (() =>
      Promise.resolve(
        Response.json(
          { __type: 'com.amazonaws.secretsmanager#AccessDeniedException', message: 'denied' },
          { status: 400 },
        ),
      )) as unknown as typeof fetch;
    const refused = putBackupSecret(value, keys, send, vectorTime);
    await expect(refused).rejects.toThrow(
      'Secrets Manager refused the new value (400, AccessDeniedException)',
    );
    await expect(refused).rejects.not.toThrow('the-new-login-phrase');
  });

  it('is sent by a script that imports nothing that writes a file', () => {
    const source = readFileSync(new URL('./backup-login.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/^import .+ from '([^']+)';$/gm)].map((m) => m[0]);
    expect(imports).toEqual([
      "import { execFileSync } from 'node:child_process';",
      "import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';",
      "import { readFileSync } from 'node:fs';",
      "import { pathToFileURL } from 'node:url';",
      "import postgres from 'postgres';",
    ]);
    expect(source).not.toMatch(/file:\/\/|tmpdir|--secret-string/);
  });
});

describe("the AWS command line's credentials", () => {
  it('are read from export-credentials, with the session token when there is one', () => {
    const output = (extra: Record<string, unknown>) =>
      JSON.stringify({
        Version: 1,
        AccessKeyId: VECTOR[0],
        SecretAccessKey: VECTOR[1],
        ...extra,
      });
    expect(parseExportedCredentials(output({ SessionToken: 'session-value' }))).toEqual({
      ...vectorKeys,
      sessionToken: 'session-value',
    });
    expect(parseExportedCredentials(output({}))).toEqual(vectorKeys);
  });

  it('stop on anything else, without quoting what the command printed', () => {
    for (const output of [
      '',
      'not json, the-printed-phrase',
      'null',
      JSON.stringify({ Version: 2, AccessKeyId: 'a', SecretAccessKey: 'the-printed-phrase' }),
      JSON.stringify({ Version: 1, AccessKeyId: 'a', SecretAccessKey: '' }),
    ]) {
      expect(() => parseExportedCredentials(output)).toThrow(
        'the AWS command line gave no credentials',
      );
      try {
        parseExportedCredentials(output);
      } catch (error) {
        expect(String(error)).not.toContain('the-printed-phrase');
      }
    }
  });
});

describe("the production database's password", () => {
  it('is taken out of the environment, so no child process inherits it', () => {
    const name = 'BACKUP_LOGIN_TEST_PHRASE';
    process.env[name] = 'a typed phrase';
    expect(takeSecret(name)).toBe('a typed phrase');
    expect(process.env[name]).toBeUndefined();
    const child = spawnSync(
      process.execPath,
      ['-e', `process.stdout.write(String(process.env.${name}))`],
      { encoding: 'utf8' },
    );
    expect(child.stdout).toBe('undefined');
    expect(() => takeSecret(name)).toThrow(`${name} is not set`);
  });
});
