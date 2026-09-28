import { describe, expect, it } from 'vitest';
import { compareSemver } from './common';
import { API_FIXTURES } from './fixtures';
import { MeResponse } from './me';

describe('compareSemver', () => {
  it('compares each part as a number, not as text', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.0', '1.2.0')).toBe(0);
    expect(compareSemver('1.2.3', '1.2.10')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '10.0.0')).toBeLessThan(0);
  });

  it('decides the update gate of /me: an app below the minimum version must update', () => {
    const me = MeResponse.parse(API_FIXTURES.me.response);
    expect(compareSemver('1.1.9', me.minimumAppVersion)).toBeLessThan(0);
    expect(compareSemver('1.2.0', me.minimumAppVersion)).toBe(0);
    expect(compareSemver(me.latestAppVersion, me.minimumAppVersion)).toBeGreaterThan(0);
  });
});
