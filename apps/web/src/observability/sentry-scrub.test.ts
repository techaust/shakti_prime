import { describe, expect, it } from 'vitest';
import { sentryInitOptions, serverSentrySettings } from './sentry-options';
import { scrubBreadcrumb, scrubEvent, withoutQuery } from './sentry-scrub';

const PRINCIPAL = '0199a0c4-7a10-7c3e-8f21-3b5d6e7f8a01';
const REQUEST = 'bom1::abcde-1727430000000';

/** An error event as the SDK might build it for a failed save, with everything it could carry. */
function failedSaveEvent() {
  return {
    event_id: 'a1b2c3',
    message: 'save failed for rekha.sharma@example.com at 98765 43210',
    server_name: 'ip-10-0-0-1',
    user: { id: PRINCIPAL, email: 'rekha.sharma@example.com', ip_address: '203.0.113.9' },
    tags: { principalId: PRINCIPAL, requestId: REQUEST, customer: 'Rekha Sharma', runtime: 'node' },
    request: {
      method: 'POST',
      url: 'https://bos.example.in/set-password?token=secret-reset-value',
      query_string: 'token=secret-reset-value',
      cookies: { 'shakti.session_token': 'session-value' },
      headers: { cookie: 'shakti.session_token=session-value', authorization: 'Bearer x' },
      data: { phone: '+919876543210', password: 'hunter2-hunter2' },
    },
    exception: {
      values: [
        {
          type: 'DomainError',
          value: 'Aadhaar 2345 6789 0123 did not match for +91 98765 43210',
          stacktrace: {
            frames: [
              {
                filename: 'app:///leads/new?phone=9876543210',
                function: 'createLead',
                vars: { phone: '9876543210', password: 'hunter2-hunter2' },
              },
            ],
          },
        },
      ],
    },
    extra: {
      password: 'hunter2-hunter2',
      note: 'call 09876543210 or mail a@b.co',
      aadhaar: '234567890123',
      leadId: PRINCIPAL,
    },
    contexts: { form: { email: 'rekha.sharma@example.com', count: 3 } },
    breadcrumbs: [
      {
        category: 'fetch',
        message: 'POST /api/v1/leads?search=Rekha',
        data: { url: '/api/v1/leads?search=Rekha', method: 'POST', status_code: 500 },
      },
      { category: 'console', message: 'typed 2345-6789-0123 into the form' },
    ],
  };
}

describe('scrubEvent (docs/design/phase1.md §5.2)', () => {
  const scrubbed = scrubEvent(failedSaveEvent());
  const text = JSON.stringify(scrubbed);

  it('keeps no phone number, email address, Aadhaar-like number or password anywhere', () => {
    for (const value of [
      '98765 43210',
      '9876543210',
      '+919876543210',
      'rekha.sharma@example.com',
      'a@b.co',
      '2345 6789 0123',
      '234567890123',
      '2345-6789-0123',
      'hunter2-hunter2',
      '203.0.113.9',
    ]) {
      expect({ value, found: text.includes(value) }).toEqual({ value, found: false });
    }
    expect(scrubbed.message).toBe('save failed for [email] at ******3210');
    expect(scrubbed.extra).toMatchObject({ password: '[redacted]', aadhaar: '[redacted]' });
  });

  it('sends no cookie, header, query string or body, only the method and path', () => {
    expect(scrubbed.request).toEqual({
      method: 'POST',
      url: 'https://bos.example.in/set-password',
    });
    expect(text).not.toContain('session-value');
    expect(text).not.toContain('secret-reset-value');
    expect(text).not.toContain('search=Rekha');
  });

  it('names the person by principal id only, and keeps only the principal and request ids as tags', () => {
    expect(scrubbed.user).toEqual({ id: PRINCIPAL });
    expect(scrubbed.tags).toEqual({ principalId: PRINCIPAL, requestId: REQUEST });
    expect(scrubbed).not.toHaveProperty('server_name');
  });

  it('drops the local variables of every stack frame and the query of its file', () => {
    const frame = scrubbed.exception.values[0]?.stacktrace.frames[0];
    expect(frame).toEqual({ filename: 'app:///leads/new', function: 'createLead' });
    expect(scrubbed.exception.values[0]?.value).toBe(
      'Aadhaar [number] did not match for ********3210',
    );
  });

  it('keeps ids and counts, which say what failed without saying who', () => {
    expect(scrubbed.extra).toMatchObject({ leadId: PRINCIPAL });
    expect(scrubbed.contexts).toEqual({ form: { email: '[email]', count: 3 } });
  });

  it('scrubs breadcrumbs: their addresses lose the query, their text the numbers', () => {
    expect(scrubbed.breadcrumbs[0]).toMatchObject({
      message: 'POST /api/v1/leads',
      data: { url: '/api/v1/leads', method: 'POST', status_code: 500 },
    });
    expect(scrubbed.breadcrumbs[1]?.message).toBe('typed [number] into the form');
  });

  it('removes a person with no id and tags that are not ids', () => {
    const bare = scrubEvent({ user: { email: 'x@y.in' }, tags: { requestId: 'bad id\nline' } });
    expect(bare).not.toHaveProperty('user');
    expect(bare.tags).toEqual({});
  });

  it('scrubs a transaction: its name and the text and data of its spans', () => {
    const transaction = scrubEvent({
      type: 'transaction',
      transaction: 'GET /set-password?token=abc',
      spans: [
        {
          description: 'select * from contacts where phone = 9876543210',
          data: { 'http.url': '/x?token=abc', password: 'p' },
        },
      ],
    });
    expect(transaction.transaction).toBe('GET /set-password');
    expect(transaction.spans[0]?.description).toBe(
      'select * from contacts where phone = ******3210',
    );
    expect(transaction.spans[0]?.data).toMatchObject({ password: '[redacted]' });
  });
});

describe('query strings in context, span and breadcrumb fields', () => {
  const search = '/leads?q=Ramesh%20Kumar';

  it('drops fields that hold a query and cuts the query from every address or path', () => {
    const scrubbed = scrubEvent({
      contexts: {
        trace: {
          data: {
            'http.target': search,
            'http.query': 'q=Ramesh%20Kumar',
            'url.full': `https://bos.example.in${search}`,
            'url.query': '?q=Ramesh%20Kumar',
            'url.path': search,
          },
        },
      },
      extra: { path: search, target: search, count: 2 },
      spans: [
        { description: `GET ${search}`, data: { 'http.url': search, 'url.query': 'q=Ramesh' } },
      ],
      breadcrumbs: [{ category: 'fetch', data: { url: search, method: 'GET' } }],
    });
    expect(JSON.stringify(scrubbed)).not.toMatch(/Ramesh|q=/);
    expect(scrubbed.contexts).toEqual({
      trace: {
        data: {
          'http.target': '/leads',
          'url.full': 'https://bos.example.in/leads',
          'url.path': '/leads',
        },
      },
    });
    expect(scrubbed.extra).toEqual({ path: '/leads', target: '/leads', count: 2 });
    expect(scrubbed.spans[0]).toEqual({ description: 'GET /leads', data: { 'http.url': '/leads' } });
    expect(scrubbed.breadcrumbs[0]?.data).toEqual({ url: '/leads', method: 'GET' });
  });
});

describe('scrubBreadcrumb', () => {
  it('scrubs a navigation breadcrumb’s addresses and leaves the rest', () => {
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        data: { from: '/leads?q=9876543210', to: '/set-password?token=abc' },
      }),
    ).toEqual({ category: 'navigation', data: { from: '/leads', to: '/set-password' } });
  });
});

describe('withoutQuery', () => {
  it('cuts at the query string or the fragment', () => {
    expect(withoutQuery('/a?b=c#d')).toBe('/a');
    expect(withoutQuery('/a#d')).toBe('/a');
    expect(withoutQuery('/a')).toBe('/a');
  });
});

describe('sentryInitOptions', () => {
  it('starts nothing without a DSN', () => {
    expect(sentryInitOptions(serverSentrySettings({ NODE_ENV: 'test' }))).toBeUndefined();
    expect(
      sentryInitOptions(serverSentrySettings({ NODE_ENV: 'test', SENTRY_DSN: '  ' })),
    ).toBeUndefined();
  });

  it('names the commit and the environment, sends no personal data and scrubs every event', () => {
    const options = sentryInitOptions(
      serverSentrySettings({
        NODE_ENV: 'test',
        SENTRY_DSN: 'https://publickey@o4501.ingest.us.sentry.io/4502',
        VERCEL_GIT_COMMIT_SHA: 'f0543b1',
        BOS_ENVIRONMENT: 'staging',
      }),
    );
    expect(options).toMatchObject({
      dsn: 'https://publickey@o4501.ingest.us.sentry.io/4502',
      release: 'f0543b1',
      environment: 'staging',
      sendDefaultPii: false,
    });
    const event = options?.beforeSend({ user: { id: PRINCIPAL, email: 'x@y.in' } });
    expect(event).toEqual({ user: { id: PRINCIPAL } });
    expect(options?.beforeSendTransaction({ transaction: '/a?b=1' })).toEqual({
      transaction: '/a',
    });
    expect(options?.beforeBreadcrumb({ message: 'mail x@y.in' })).toEqual({
      message: 'mail [email]',
    });
  });
});
