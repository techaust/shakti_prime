import { describe, expect, it } from 'vitest';
import { jsonLogger, memoryLogger, redact, redactError, redactText } from './logger';

describe('redaction (AUDIT M10)', () => {
  it('scrubs set-password links, query parameters, credentials and email addresses from text', () => {
    expect(redactText('open http://x/api/auth/reset-password/abcDEF123?callbackURL=%2F')).toBe(
      'open http://x/api/auth/reset-password:[redacted]?callbackURL=%2F',
    );
    expect(
      redactText(
        'Failed query: select * from auth_verifications where identifier = $1\nparams: reset-password:tok,asha@x.in',
      ),
    ).toBe(
      'Failed query: select * from auth_verifications where identifier = $1\nparams: [redacted]',
    );
    expect(redactText('token=abc&x=1 password=hunter2')).toBe(
      'token=[redacted]&x=1 password=[redacted]',
    );
    expect(redactText('no user asha.meena@shakti.in')).toBe('no user [email]');
  });

  it('keeps the last four digits of phone numbers and hides twelve-digit numbers in full', () => {
    expect(redactText('call +919876543210 or 9812345678, not 5123456789')).toBe(
      'call +********3210 or ******5678, not 5123456789',
    );
    for (const aadhaar of ['2345 6789 0123', '2345-6789-0123', '234567890123']) {
      expect(redactText(`Aadhaar ${aadhaar} on file`)).toBe('Aadhaar [number] on file');
    }
    expect(redactText('uid:919876543210.')).toBe('uid:[number].');
    // The digit groups of an id are not personal numbers.
    const ids = [
      '01928a3b-1234-7123-8123-123456789012',
      '01928a3b-4c5d-7e6f-8a9b-987654321098',
      'order 1727430000000',
    ];
    for (const id of ids) expect(redactText(id)).toBe(id);
  });

  it('drops identity-number fields whatever their case or separators', () => {
    expect(
      redact({
        requestId: 'r-1',
        aadhaar: '234567890123',
        Aadhaar_Number: '234567890123',
        uid: '234567890123',
        PAN: 'ABCDE1234F',
        account_number: '50100012345678',
        accountNumber: '50100012345678',
        IFSC: 'HDFC0000001',
        nested: { ifsc_code: 'HDFC0000001', bankAccountNumber: '50100012345678' },
      }),
    ).toEqual({
      requestId: 'r-1',
      aadhaar: '[redacted]',
      Aadhaar_Number: '[redacted]',
      uid: '[redacted]',
      PAN: '[redacted]',
      account_number: '[redacted]',
      accountNumber: '[redacted]',
      IFSC: '[redacted]',
      nested: { ifsc_code: '[redacted]', bankAccountNumber: '[redacted]' },
    });
  });

  it('keeps the codes and the cause chain of an error, and drops bound values', () => {
    const cause = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint_name: 'users_email_unique',
      parameters: ['asha@shakti.in'],
    });
    const error = Object.assign(
      new Error('Failed query: insert into users\nparams: asha@shakti.in'),
      {
        query: 'insert into users',
        params: ['asha@shakti.in'],
        cause,
      },
    );
    expect(redactError(error)).toEqual({
      name: 'Error',
      message: 'Failed query: insert into users\nparams: [redacted]',
      cause: {
        name: 'Error',
        message: 'duplicate key value',
        code: '23505',
        constraint_name: 'users_email_unique',
      },
    });
  });
});

describe('jsonLogger', () => {
  it('writes one JSON line with level, event, time and redacted fields', () => {
    const lines: string[] = [];
    jsonLogger((_level, line) => lines.push(line)).log('error', 'auth.failed', {
      requestId: 'r-1',
      token: 'abc',
      error: new Error('link reset-password/xyz failed'),
    });
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'error',
      event: 'auth.failed',
      requestId: 'r-1',
      token: '[redacted]',
      error: { message: 'link reset-password:[redacted] failed' },
    });
    expect(typeof entry.time).toBe('string');
  });

  it('the memory logger keeps redacted entries', () => {
    const log = memoryLogger();
    log.log('warn', 'cache.miss', { cookie: 'shakti.session_token=abc' });
    expect(log.entries).toEqual([
      { level: 'warn', event: 'cache.miss', fields: { cookie: '[redacted]' } },
    ]);
  });
});
