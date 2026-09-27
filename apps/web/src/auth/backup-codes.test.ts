import { describe, expect, it } from 'vitest';
import { generateBackupCodes, normaliseBackupCode } from './backup-codes';

describe('backup codes (AUDIT M51)', () => {
  it('are ten readable codes without look-alike characters', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  });

  it('accept what a person types: capitals, spaces and no dash', () => {
    expect(normaliseBackupCode('Abcde-fghjk')).toBe('abcde-fghjk');
    expect(normaliseBackupCode(' abcde fghjk ')).toBe('abcde-fghjk');
    expect(normaliseBackupCode('ABCDEFGHJK')).toBe('abcde-fghjk');
    expect(normaliseBackupCode('short')).toBe('short');
  });
});
