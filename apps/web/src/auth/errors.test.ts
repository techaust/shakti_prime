import { DomainError } from '@shakti/contracts';
import { APIError } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import hi from '../../messages/hi.json';
import { errorKey, REASONS, toDomainError } from './errors';

describe('Better Auth errors → catalogue keys', () => {
  it('every mapped reason has a sentence in both languages', () => {
    for (const { reason } of Object.values(REASONS)) {
      expect(en.errors, reason).toHaveProperty(reason);
      expect(hi.errors, reason).toHaveProperty(reason);
    }
  });

  it('names the two-factor codes the installed plugin actually throws', () => {
    const codes = Object.keys(twoFactor().$ERROR_CODES);
    for (const code of [
      'INVALID_CODE',
      'INVALID_BACKUP_CODE',
      'ACCOUNT_TEMPORARILY_LOCKED',
      'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
      'INVALID_TWO_FACTOR_COOKIE',
      'TOTP_NOT_ENABLED',
    ]) {
      expect(codes, code).toContain(code);
      expect(REASONS, code).toHaveProperty(code);
    }
  });

  it('falls back by status and never leaks the vendor message as a key', () => {
    const unknown = new APIError('BAD_REQUEST', { message: 'Something vendor-specific' });
    const mapped = toDomainError(unknown);
    expect(mapped.code).toBe('validation_failed');
    expect(errorKey(mapped)).toBe('validation_failed');
    expect(errorKey(new DomainError('conflict'))).toBe('conflict');
    expect(toDomainError(new Error('boom')).code).toBe('internal');
  });
});
