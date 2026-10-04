import { FILE_PURPOSES, type FilePurpose, type PermissionKey, type Scope } from '@shakti/contracts';
import type { PermissionByInput, Requirement } from '../command/define-command';

/**
 * Who may upload and read a file of each purpose (docs/SECURITY.md §8). The database holds the
 * same mapping in `app.file_purpose_grant()`, which the `files` policies read; a test on real
 * Postgres compares the two, so they cannot drift apart.
 *
 * `write` is the permission, at its narrowest scope, that may upload the file; null when no request
 * may (the field photos wait for their modules; the vault for K1, whose permission
 * `knowledge.vault.write` is not in the catalogue yet). `read` is the permission that reads it: a
 * holder at entity scope reads every such file of the company, a narrower holder the files they
 * uploaded; `company` lets every principal of the company read it (a logo and a letterhead print
 * on every document); null hides it from every request.
 */
export interface FilePurposeRule {
  write: Requirement | null;
  read: PermissionKey | 'company' | null;
}

const needs = (permission: PermissionKey, minScope: Scope): Requirement => ({
  permission,
  minScope,
});

export const FILE_PURPOSE_RULES: Readonly<Record<FilePurpose, FilePurposeRule>> = {
  job_photo: { write: null, read: null },
  survey_photo: { write: null, read: null },
  qc_photo: { write: null, read: null },
  receipt: { write: null, read: null },
  signature: { write: null, read: null },
  selfie: { write: null, read: null },
  customer_document: { write: null, read: null },
  import: { write: needs('imports.write', 'entity'), read: 'imports.write' },
  // Only the render worker stores a quote's PDF; a signed copy comes from whoever accepts quotes.
  quote_pdf: { write: needs('files.process', 'entity'), read: 'crm.lead.read' },
  signed_quote: { write: needs('sales.quote.send', 'own'), read: 'crm.lead.read' },
  entity_logo: { write: needs('admin.entities.write', 'all'), read: 'company' },
  letterhead: { write: needs('admin.entities.write', 'all'), read: 'company' },
  // A company's proof page prints its bank account: rendered by the worker, read by an Executive.
  print_proof: { write: needs('files.process', 'entity'), read: 'admin.entities.write' },
  knowledge: { write: null, read: null },
  consent_evidence: { write: needs('crm.account.write', 'own'), read: 'crm.account.write' },
};

/** The answer `app.file_purpose_grant(purpose, access)` gives, in its own shape. */
export function filePurposeGrant(purpose: FilePurpose, access: 'write' | 'read'): string | null {
  const rule = FILE_PURPOSE_RULES[purpose];
  if (access === 'read') return rule.read;
  return rule.write === null ? null : `${rule.write.permission}:${rule.write.minScope}`;
}

/** The purposes a person may upload through the upload flow (an import has its own screen). */
export const UPLOADABLE_PURPOSES: readonly FilePurpose[] = FILE_PURPOSES.filter(
  (p) => p !== 'import' && FILE_PURPOSE_RULES[p].write !== null,
);

/**
 * The upload commands' permission: the one the purpose names. Every key a purpose can name is
 * listed, so the agent refusal sweep covers the commands.
 */
export const uploadPermission: PermissionByInput<{ purpose: FilePurpose }> = {
  keys: [
    ...new Set(
      Object.values(FILE_PURPOSE_RULES).flatMap((r) => (r.write ? [r.write.permission] : [])),
    ),
  ],
  of: ({ purpose }) => (purpose === 'import' ? null : FILE_PURPOSE_RULES[purpose].write),
};
