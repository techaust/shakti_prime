import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';
import { SECURE_SESSION_COOKIE, SESSION_COOKIE } from './session-gate';

function request(path: string, cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie !== undefined) headers.set('cookie', cookie);
  return new NextRequest(new URL(path, 'https://bos.shakti.test'), { headers });
}

describe('proxy', () => {
  it('redirects a BOS screen without a session cookie to sign-in', () => {
    const response = proxy(request('/leads'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://bos.shakti.test/sign-in');
  });

  it('passes a BOS screen with a session cookie on, with a nonce policy', () => {
    for (const name of [SESSION_COOKIE, SECURE_SESSION_COOKIE]) {
      const response = proxy(request('/home', `${name}=abc`));
      expect(response.headers.get('location')).toBeNull();
      expect(response.headers.get('Content-Security-Policy')).toMatch(/'nonce-[^']+'/);
    }
  });

  it('serves public pages without a session, with a fresh nonce each time', () => {
    const first = proxy(request('/sign-in')).headers.get('Content-Security-Policy');
    const second = proxy(request('/sign-in')).headers.get('Content-Security-Policy');
    expect(first).toMatch(/'nonce-[^']+'/);
    expect(first).not.toBe(second);
    expect(proxy(request('/')).headers.get('location')).toBeNull();
  });
});
