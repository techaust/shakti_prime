import { DomainError } from '@shakti/contracts';
import { describe, expect, it, vi } from 'vitest';
import { REFERENCE_LENGTH } from '../reference';
import { actionFailure, toResult } from './result';

describe('action results (review 3)', () => {
  it('answer the data of a body that succeeds', async () => {
    await expect(toResult('x', () => Promise.resolve(7))).resolves.toEqual({ ok: true, data: 7 });
  });

  it('name the catalogue reason of a domain error, else its code', () => {
    expect(
      actionFailure('x', new DomainError('conflict', 'raced', { reason: 'last_executive' })),
    ).toEqual({ ok: false, error: 'last_executive' });
    expect(actionFailure('x', new DomainError('forbidden'))).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  it('name the catalogue reason an input schema gives its problem, never any other message', () => {
    const invalid = (message: string) =>
      new DomainError('validation_failed', 'invalid input', {
        issues: [{ path: 'textVersion', message }],
      });
    expect(actionFailure('x', invalid('consent_version_invalid'))).toEqual({
      ok: false,
      error: 'consent_version_invalid',
      field: 'textVersion',
    });
    expect(actionFailure('x', invalid('Invalid string: must match pattern'))).toEqual({
      ok: false,
      error: 'validation_failed',
      field: 'textVersion',
    });
    expect(actionFailure('x', invalid('not_a_catalogue_key'))).toEqual({
      ok: false,
      error: 'validation_failed',
      field: 'textVersion',
    });
  });

  it('name the first field of an input problem', () => {
    const e = new DomainError('validation_failed', 'bad', {
      issues: [
        { path: 'contact.phone', message: 'x' },
        { path: 'account.type', message: 'y' },
      ],
    });
    expect(actionFailure('x', e)).toEqual({
      ok: false,
      error: 'validation_failed',
      field: 'contact.phone',
    });
  });

  it('log an unexpected failure and answer the reference for support, never the message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = actionFailure('x', new Error('connection refused at 10.0.0.1'));
      expect(result.ok).toBe(false);
      expect(result.error).toBe('internal');
      expect(result.reference).toHaveLength(REFERENCE_LENGTH);
      expect(JSON.stringify(result)).not.toContain('10.0.0.1');
    } finally {
      spy.mockRestore();
    }
  });
});
