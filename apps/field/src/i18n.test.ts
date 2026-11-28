import en from '../messages/en.json';
import { errorKey, format, t } from './i18n';

describe('the copy helper', () => {
  it('fills values and picks the plural form', () => {
    expect(t('settings.version', { version: '1.0.0' })).toBe('App version 1.0.0');
    expect(t('unlock.wrong', { count: 1 })).toBe('That PIN is not right. You have 1 try left.');
    expect(t('unlock.wrong', { count: 3 })).toBe('That PIN is not right. You have 3 tries left.');
    expect(format('{name} and {other}', { name: 'Rakesh' })).toBe('Rakesh and {other}');
  });

  it('has a sentence for every reason the sign-in routes give, and a general one for the rest', () => {
    for (const reason of [
      'invalid_credentials',
      'totp_required',
      'totp_invalid',
      'totp_setup_required',
      'account_locked',
      'account_suspended',
      'refresh_expired',
      'refresh_reused',
      'device_revoked',
    ]) {
      expect(errorKey(reason)).toBe(`errors.${reason}`);
    }
    expect(errorKey('something_new')).toBe('errors.unexpected');
    expect(Object.keys(en.errors).length).toBeGreaterThan(10);
  });
});
