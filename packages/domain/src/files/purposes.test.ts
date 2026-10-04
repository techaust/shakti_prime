import { FILE_PURPOSES } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  FILE_PURPOSE_RULES,
  filePurposeGrant,
  UPLOADABLE_PURPOSES,
  uploadPermission,
} from './purposes';

describe('file purposes', () => {
  it('has a rule for every purpose', () => {
    expect(Object.keys(FILE_PURPOSE_RULES).sort()).toEqual([...FILE_PURPOSES].sort());
  });

  it('opens the upload flow to the purposes with a writer, never to imports or the vault yet', () => {
    expect([...UPLOADABLE_PURPOSES].sort()).toEqual(
      [
        'consent_evidence',
        'entity_logo',
        'letterhead',
        'print_proof',
        'quote_pdf',
        'signed_quote',
      ].sort(),
    );
    expect(uploadPermission.of({ purpose: 'import' })).toBeNull();
    expect(uploadPermission.of({ purpose: 'knowledge' })).toBeNull();
    expect(uploadPermission.of({ purpose: 'job_photo' })).toBeNull();
    expect(uploadPermission.of({ purpose: 'entity_logo' })).toEqual({
      permission: 'admin.entities.write',
      minScope: 'all',
    });
  });

  it('lists every permission an upload can need', () => {
    expect([...uploadPermission.keys].sort()).toEqual(
      [
        'admin.entities.write',
        'crm.account.write',
        'files.process',
        'imports.write',
        'sales.quote.send',
      ].sort(),
    );
  });

  it('answers in the shape of app.file_purpose_grant()', () => {
    expect(filePurposeGrant('import', 'write')).toBe('imports.write:entity');
    expect(filePurposeGrant('import', 'read')).toBe('imports.write');
    expect(filePurposeGrant('letterhead', 'read')).toBe('company');
    expect(filePurposeGrant('knowledge', 'write')).toBeNull();
    expect(filePurposeGrant('knowledge', 'read')).toBeNull();
  });
});
