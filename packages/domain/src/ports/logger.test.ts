import { describe, expect, it } from 'vitest';
import { jsonLogger, memoryLogger, redactError, redactText } from './logger';

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
