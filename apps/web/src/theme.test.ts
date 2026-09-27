import { describe, expect, it } from 'vitest';
import { themeCookie } from './theme';

describe('themeCookie', () => {
  it('keeps the choice for a year, site-wide', () => {
    expect(themeCookie('dark', true)).toBe(
      'theme=dark; Path=/; Max-Age=31536000; SameSite=Lax; Secure',
    );
  });

  it('is sent over plain http only on a local machine', () => {
    expect(themeCookie('light', false)).not.toContain('Secure');
  });

  it('clears the cookie when there is no choice to keep', () => {
    expect(themeCookie(undefined, true)).toBe('theme=; Path=/; Max-Age=0; SameSite=Lax; Secure');
  });
});
