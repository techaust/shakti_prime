import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const DOCUMENT_FILING_STATES = [
  'pending',
  'scanning',
  'masked',
  'ready',
  'rejected',
] as const;
export type DocumentFilingState = (typeof DOCUMENT_FILING_STATES)[number];
export type DocumentFilingEvent = 'receive' | 'scan' | 'mask' | 'file' | 'reject';

export interface DocumentFilingRecord {
  state: DocumentFilingState | null;
  /** The malware scan result: true clean, false infected, null not finished. */
  scanClean: boolean | null;
  /** The customer who sent the file on WhatsApp; null for a staff upload. */
  senderAccountId: string | null;
  /** The customer the file is being filed against. */
  targetAccountId: string | null;
  /** The classifier's confidence was low, so a person must confirm the filing. */
  needsReview: boolean;
}

export interface DocumentFilingParams {
  reason?: string | null;
}

type G = Guard<DocumentFilingRecord, DocumentFilingParams>;

const clean: G = {
  description: 'the malware scan finished clean',
  check: (record) =>
    record.scanClean === true ? undefined : { code: 'conflict', reason: 'file_not_clean' },
};

const sameCustomer: G = {
  description: 'the file is filed against the customer who sent it (WA-02)',
  check: (record) =>
    record.targetAccountId !== null &&
    (record.senderAccountId === null || record.senderAccountId === record.targetAccountId)
      ? undefined
      : { code: 'forbidden', reason: 'file_customer_mismatch' },
};

const confidentOrPerson: G = {
  description:
    'the platform files only a confident classification; a low-confidence one waits for a person',
  check: (record, { actor }) =>
    actor.kind === 'system' && record.needsReview
      ? { code: 'conflict', reason: 'file_needs_review' }
      : undefined,
};

/**
 * WhatsApp document filing (BLUEPRINT §8.6, PRD WA-02): every incoming photo or PDF is scanned,
 * masked (Aadhaar numbers never stored; CLAUDE.md "Identity documents"), classified and filed.
 */
export const documentFilingMachine = defineMachine<
  DocumentFilingState,
  DocumentFilingEvent,
  DocumentFilingRecord,
  DocumentFilingParams
>({
  name: 'document_filing',
  title: 'WhatsApp document filing',
  summary:
    '`files.status`. The masking step runs before storage of the kept copy and before any classifier sees the file.',
  sources: ['BLUEPRINT §7.5, §8.6, §19 item 2', 'PRD WA-02', 'DATABASE §6.10 `files`'],
  states: DOCUMENT_FILING_STATES,
  initial: 'pending',
  terminal: ['ready', 'rejected'],
  stateNotes: {
    masked: 'Masked copy kept; only the last four Aadhaar digits survive.',
    ready: 'Classified and filed against a requirement in the vault.',
  },
  transitions: [
    {
      from: 'new',
      event: 'receive',
      to: 'pending',
      permission: 'documents.write',
      system: true,
      note: 'The WhatsApp webhook worker (platform) or a staff upload.',
    },
    {
      from: ['pending'],
      event: 'scan',
      to: 'scanning',
      permission: null,
      system: true,
    },
    {
      from: ['scanning'],
      event: 'mask',
      to: 'masked',
      permission: null,
      system: true,
      guard: clean,
      effects: [
        {
          key: 'ocr_mask',
          description: 'OCR masking: keep the masked copy and the last four digits only',
        },
      ],
    },
    {
      from: ['masked'],
      event: 'file',
      to: 'ready',
      permission: 'documents.write',
      system: true,
      guard: allOf(sameCustomer, confidentOrPerson),
      effects: [
        { key: 'attach', description: 'attach to the matching requirement in the vault' },
        { key: 'recheck_gates', description: 're-evaluate the completeness gates' },
      ],
    },
    {
      from: ['pending', 'scanning', 'masked'],
      event: 'reject',
      to: 'rejected',
      permission: 'documents.write',
      system: true,
      guard: reasonGiven('a reason is given (infected, unreadable, wrong customer)'),
      proposed: true,
    },
  ],
});
