import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES, ErrorCodeSchema, isDomainError } from './errors.js';

describe('DomainError', () => {
  it('carries a stable code and an HTTP status', () => {
    const err = new DomainError('forbidden', 'principal lacks admin.entities.write', {
      permission: 'x',
    });
    expect(err.code).toBe('forbidden');
    expect(err.status).toBe(403);
    expect(err.details).toEqual({ permission: 'x' });
    expect(isDomainError(err)).toBe(true);
    expect(isDomainError(new Error('plain'))).toBe(false);
  });

  it('every code has a status and parses through the schema', () => {
    for (const code of ERROR_CODES) {
      expect(new DomainError(code).status).toBeGreaterThanOrEqual(400);
      expect(ErrorCodeSchema.parse(code)).toBe(code);
    }
  });
});
