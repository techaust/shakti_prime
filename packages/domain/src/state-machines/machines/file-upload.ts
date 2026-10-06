import { defineMachine, reasonGiven, type Guard } from '../define-machine';

export const FILE_UPLOAD_STATES = [
  'pending',
  'scanning',
  'scanned',
  'not_scanned',
  'ready',
  'rejected',
] as const;
export type FileUploadState = (typeof FILE_UPLOAD_STATES)[number];
export type FileUploadEvent =
  'upload' | 'complete' | 'scan' | 'skip_scan' | 'ready' | 'reject' | 'abandon';

export interface FileUploadRecord {
  state: FileUploadState | null;
  /**
   * For `complete`: the object the store holds has the size and SHA-256 the upload declared; null
   * before the store was asked.
   */
  storedMatches: boolean | null;
}

export interface FileUploadParams {
  /** Why the checks refused the file (`FileRejectReasonSchema`). */
  reason?: string | null;
}

type G = Guard<FileUploadRecord, FileUploadParams>;

const storedAsDeclared: G = {
  description: 'the stored object has the size and SHA-256 the upload declared',
  check: (record) =>
    record.storedMatches === true
      ? undefined
      : { code: 'conflict', reason: 'file_upload_mismatch' },
};

const BY_PURPOSE = "the file's purpose (`packages/domain/src/files/purposes.ts`)";

/**
 * An upload from the BOS's own screens or the field app (docs/ARCHITECTURE.md §9, SECURITY §8):
 * the bytes go straight to the file store on a pre-signed address, then the worker scans them,
 * re-encodes an image, checks a PDF and masks a vault photo before anyone can use the file.
 */
export const fileUploadMachine = defineMachine<
  FileUploadState,
  FileUploadEvent,
  FileUploadRecord,
  FileUploadParams
>({
  name: 'file_upload',
  title: 'File upload',
  summary:
    '`files.status` for an upload. A file is usable only once `ready`; a WhatsApp document follows `document_filing` instead.',
  sources: ['BLUEPRINT §5', 'SECURITY §8', 'ARCHITECTURE §9', 'DATABASE §6.10 `files`'],
  states: FILE_UPLOAD_STATES,
  initial: 'pending',
  terminal: ['ready', 'rejected'],
  stored: { table: 'files', stateColumn: 'status' },
  stateNotes: {
    pending: 'Recorded with its pre-signed upload address; the bytes have not landed yet.',
    scanning: 'The bytes landed; the malware scan runs.',
    scanned: 'No threat found; the image is re-encoded, the PDF checked or the photo masked.',
    not_scanned:
      'No scanner exists (a developer’s machine); the worker records this only where the environment is not hosted.',
    ready: 'Usable: the checked copy is the one stored.',
  },
  transitions: [
    {
      from: 'new',
      event: 'upload',
      to: 'pending',
      permission: null,
      permissionByInput: BY_PURPOSE,
      system: true,
      note: '`files.upload.begin`. A PDF the render worker makes is not an upload: `files.document.record` records it `ready`.',
    },
    {
      from: ['pending'],
      event: 'complete',
      to: 'scanning',
      permission: null,
      permissionByInput: BY_PURPOSE,
      guard: storedAsDeclared,
      emits: 'files.file.uploaded',
      note: '`files.upload.complete`, by the person who began the upload.',
    },
    {
      from: ['scanning'],
      event: 'scan',
      to: 'scanned',
      permission: 'files.process',
      scope: 'entity',
      system: true,
      note: '`files.file.mark_scanned`: the GuardDuty tag reads `NO_THREATS_FOUND`.',
    },
    {
      from: ['scanning'],
      event: 'skip_scan',
      to: 'not_scanned',
      permission: 'files.process',
      scope: 'entity',
      system: true,
      note: '`files.file.mark_scanned` with no scanner, which the worker records only when not hosted.',
    },
    {
      from: ['scanned', 'not_scanned'],
      event: 'ready',
      to: 'ready',
      permission: 'files.process',
      scope: 'entity',
      system: true,
      effects: [
        {
          key: 'replace',
          description:
            'record the checked copy (re-encoded, checked or masked) in place of the upload',
        },
      ],
      note: '`files.file.mark_ready`.',
    },
    {
      from: ['scanning', 'scanned', 'not_scanned'],
      event: 'reject',
      to: 'rejected',
      permission: 'files.process',
      scope: 'entity',
      system: true,
      guard: reasonGiven('a reason is given (a threat, an unreadable file, active content)'),
      note: '`files.file.reject`; the reason is shown to the uploader.',
    },
    {
      from: ['pending'],
      event: 'abandon',
      to: 'rejected',
      permission: 'files.process',
      scope: 'entity',
      system: true,
      effects: [{ key: 'delete', description: 'delete whatever bytes landed under the key' }],
      note: '`files.upload.sweep`: an upload still pending a day after it began never completed.',
    },
  ],
});
