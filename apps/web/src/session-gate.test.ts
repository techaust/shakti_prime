import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BOS_PREFIXES,
  isBosPath,
  needsSignIn,
  safeReturnPath,
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
} from './session-gate';

const bosDir = join(dirname(fileURLToPath(import.meta.url)), 'app', '(bos)');

const jar =
  (cookies: Record<string, string>) =>
  (name: string): string | undefined =>
    cookies[name];

describe('the BOS route list', () => {
  it('names every folder of the (bos) route group, so no screen skips the proxy check', () => {
    const folders = readdirSync(bosDir).filter((name) =>
      statSync(join(bosDir, name)).isDirectory(),
    );
    const prefixes: readonly string[] = BOS_PREFIXES;
    expect(folders.map((f) => `/${f}`).filter((p) => !prefixes.includes(p))).toEqual([]);
  });

  it('matches a screen and the screens under it, not a public page that shares a prefix', () => {
    expect(isBosPath('/home')).toBe(true);
    expect(isBosPath('/leads/new')).toBe(true);
    expect(isBosPath('/admin/users')).toBe(true);
    expect(isBosPath('/homepage')).toBe(false);
    expect(isBosPath('/sign-in')).toBe(false);
    expect(isBosPath('/')).toBe(false);
  });
});

describe('needsSignIn', () => {
  it('sends a BOS screen without a session cookie to sign-in', () => {
    expect(needsSignIn('/home', jar({}))).toBe(true);
    expect(needsSignIn('/leads', jar({ theme: 'dark' }))).toBe(true);
    expect(needsSignIn('/admin/users', jar({ [SESSION_COOKIE]: '' }))).toBe(true);
  });

  it('lets a request with either session cookie through to the full check', () => {
    expect(needsSignIn('/home', jar({ [SESSION_COOKIE]: 'abc' }))).toBe(false);
    expect(needsSignIn('/home', jar({ [SECURE_SESSION_COOKIE]: 'abc' }))).toBe(false);
  });

  it('leaves public pages alone', () => {
    for (const path of ['/', '/sign-in', '/forgot-password', '/set-password', '/two-factor']) {
      expect(needsSignIn(path, jar({}))).toBe(false);
    }
  });
});

describe('safeReturnPath', () => {
  it('keeps a BOS screen on this site', () => {
    expect(safeReturnPath('/leads')).toBe('/leads');
    expect(safeReturnPath('/admin/users?q=1#top')).toBe('/admin/users');
  });

  it('answers /home for anything else', () => {
    for (const raw of [
      undefined,
      '',
      'leads',
      '//evil.example/home',
      '/\\evil.example',
      'https://evil.example/home',
      '/sign-in',
      '/api/v1/health',
      '/home /x',
    ]) {
      expect(safeReturnPath(raw)).toBe('/home');
    }
  });
});
