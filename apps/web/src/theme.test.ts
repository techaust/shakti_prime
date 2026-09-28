import { describe, expect, it } from 'vitest';
import { contrastCookie, CONTRAST_COOKIE, isHighContrast, themeCookie } from './theme';

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

describe('contrastCookie', () => {
  it('keeps the higher contrast for a year on this device and clears itself when turned off', () => {
    expect(contrastCookie(true, true)).toBe(
      `${CONTRAST_COOKIE}=high; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
    expect(contrastCookie(false, false)).toBe(
      `${CONTRAST_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`,
    );
  });

  it('reads only its own value as the higher contrast', () => {
    expect(isHighContrast('high')).toBe(true);
    expect(isHighContrast(undefined)).toBe(false);
    expect(isHighContrast('')).toBe(false);
    expect(isHighContrast('dark')).toBe(false);
  });
});
