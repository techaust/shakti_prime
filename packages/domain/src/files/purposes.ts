import { FILE_PURPOSES, type FilePurpose, type PermissionKey, type Scope } from '@shakti/contracts';
import type { PermissionByInput, Requirement } from '../command/define-command';

/**
 * Who may upload and read a file of each purpose (docs/07-security.md §8). The database holds the
 * same mapping in `app.file_purpose_grant()`, which the `files` policies read; a test on real
 * Postgres compares the two, so they cannot drift apart.
 *
 * `write` is the permission, at its narrowest scope, that may upload the file; null when no request
 * may (the field photos wait for their modules). `read` is the permission that reads it: a holder
 * at entity scope reads every such file of the company, a narrower holder the files they uploaded;
 * `company` lets every principal of the company read it (a logo and a letterhead print on every
 * document); `vault` reads it with its Knowledge Vault file, by that file's sensitivity, and its
 * uploader while they hold `knowledge.vault.write` (the policy `files_knowledge_read`), so the
 * general rule of `app.file_purpose_grant()` names nothing for it; `thread` reads it with the
 * WhatsApp message it came on, under its thread's rule (`files_whatsapp_read`); `call` reads it with
 * the provider call it is the transcript of, under its lead's rule (`files_call_transcript_read`);
 * null hides it from every request.
 */
export interface FilePurposeRule {
  write: Requirement | null;
  read: PermissionKey | 'company' | 'vault' | 'thread' | 'call' | null;
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
  // A vault file is added by an Executive or GM and read by its sensitivity (docs/03-roadmap-appendix/phase1.md §8.4).
  knowledge: { write: needs('knowledge.vault.write', 'all'), read: 'vault' },
  consent_evidence: { write: needs('crm.account.write', 'own'), read: 'crm.account.write' },
  // A call's recording is stored by the platform (`app.attach_call_recording()`) and heard only
  // through `calls.recording.play`, which checks `calls.recording.listen` and audits each listen;
  // no request uploads or opens it as a file.
  call_recording: { write: null, read: null },
  // A file a customer sent on WhatsApp: stored by the platform alone, read with its thread.
  whatsapp_media: { write: null, read: 'thread' },
  // A recorded call's transcript, masked before it is stored by the platform: read with the call,
  // so whoever reads the lead reads it (docs/03-roadmap-appendix/phase2.md §7.3).
  call_transcript: { write: null, read: 'call' },
  // U1: a supplier's quote document shows the rate, so it is uploaded and read only with
  // procurement.rate.read; procurement.quote.record also asks for procurement.po.write.
  vendor_quote: {
    write: needs('procurement.rate.read', 'entity'),
    read: 'procurement.rate.read',
  },
  // FN1: a proforma's PDF prints the company's bank account and UPI ID: rendered by the worker,
  // read with finance.read (a holder for the company reads every one; a narrower holder reads it
  // with the proforma, `files_proforma_pdf_read`).
  proforma_pdf: { write: needs('files.process', 'entity'), read: 'finance.read' },
};

/** The answer `app.file_purpose_grant(purpose, access)` gives, in its own shape. */
export function filePurposeGrant(purpose: FilePurpose, access: 'write' | 'read'): string | null {
  const rule = FILE_PURPOSE_RULES[purpose];
  if (access === 'read') {
    return rule.read === 'vault' || rule.read === 'thread' || rule.read === 'call'
      ? null
      : rule.read;
  }
  return rule.write === null ? null : `${rule.write.permission}:${rule.write.minScope}`;
}

/** The purposes a person may upload through the upload flow, an import file among them. */
export const UPLOADABLE_PURPOSES: readonly FilePurpose[] = FILE_PURPOSES.filter(
  (p) => FILE_PURPOSE_RULES[p].write !== null,
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
  of: ({ purpose }) => FILE_PURPOSE_RULES[purpose].write,
};
