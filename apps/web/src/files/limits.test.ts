import { IMPORT_LIMITS } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { UPLOAD_BODY_LIMIT, UPLOAD_BODY_LIMIT_BYTES } from './limits';

describe('the upload body limit', () => {
  it('takes the largest import file with room for the form around it', () => {
    expect(UPLOAD_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(IMPORT_LIMITS.maxFileBytes + 64 * 1024);
    expect(UPLOAD_BODY_LIMIT).toBe(`${String(UPLOAD_BODY_LIMIT_BYTES / 1024 / 1024)}mb`);
  });
});
