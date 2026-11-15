import {
  IMPORT_LIMITS,
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  type FilePurpose,
  type UploadContentType,
} from '@shakti/contracts';

/**
 * What an upload of a purpose may be: its types and its largest size, and a larger size for the
 * types that have one (a vault recording).
 */
export interface UploadLimit {
  contentTypes: readonly UploadContentType[];
  maxBytes: number;
  maxBytesOf?: Readonly<Partial<Record<UploadContentType, number>>>;
}

const IMAGES: readonly UploadContentType[] = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGES_AND_PDF: readonly UploadContentType[] = [...IMAGES, 'application/pdf'];
const SHEETS: readonly UploadContentType[] = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/**
 * A vault file: a photo, a PDF, a Word document, an Excel workbook (BLUEPRINT §9.1) or a recording
 * as a WAV (K3; MP3, M4A and OGG would need a decoder the BOS does not have).
 */
const VAULT: readonly UploadContentType[] = [...IMAGES_AND_PDF, WORD, WORKBOOK, 'audio/wav'];
const MB = 1024 * 1024;

/**
 * Limits per purpose (docs/07-security.md §8), checked by `files.upload.begin` and by the uploader
 * before any byte is sent. A logo and a letterhead are images, because documents print them as
 * pictures; a quote's PDF is a PDF; a signed quote, consent evidence or vault file may be a photo
 * or a scan, and a vault file a Word document or an Excel workbook as well; an import file is a
 * CSV or an Excel workbook within the import's own limit. A vault recording may be 25 MB, every
 * other vault file 15 MB.
 */
export const UPLOAD_LIMITS: Readonly<Partial<Record<FilePurpose, UploadLimit>>> = {
  quote_pdf: { contentTypes: ['application/pdf'], maxBytes: 10 * MB },
  signed_quote: { contentTypes: IMAGES_AND_PDF, maxBytes: MAX_UPLOAD_BYTES },
  entity_logo: { contentTypes: IMAGES, maxBytes: 2 * MB },
  letterhead: { contentTypes: IMAGES, maxBytes: 5 * MB },
  print_proof: { contentTypes: ['application/pdf'], maxBytes: 10 * MB },
  knowledge: {
    contentTypes: VAULT,
    maxBytes: MAX_UPLOAD_BYTES,
    maxBytesOf: { 'audio/wav': MAX_AUDIO_UPLOAD_BYTES },
  },
  consent_evidence: { contentTypes: IMAGES_AND_PDF, maxBytes: MAX_UPLOAD_BYTES },
  import: { contentTypes: SHEETS, maxBytes: IMPORT_LIMITS.maxFileBytes },
};

/** Why an upload is refused before it starts; each has a sentence in the message catalogue. */
export type UploadLimitProblem = 'file_type_not_allowed' | 'file_too_large';

/** The problem with an upload of this type and size, or undefined when it fits its purpose. */
export function uploadLimitProblem(
  purpose: FilePurpose,
  contentType: string,
  size: number,
): UploadLimitProblem | undefined {
  const limit = UPLOAD_LIMITS[purpose];
  if (limit === undefined || !(limit.contentTypes as readonly string[]).includes(contentType)) {
    return 'file_type_not_allowed';
  }
  return size > uploadMaxBytes(limit, contentType as UploadContentType)
    ? 'file_too_large'
    : undefined;
}

/** The largest upload of a type within a purpose's limit. */
export function uploadMaxBytes(limit: UploadLimit, contentType: UploadContentType): number {
  return limit.maxBytesOf?.[contentType] ?? limit.maxBytes;
}

/** The file name extension the store's key carries for a type. */
export const EXTENSIONS: Readonly<Record<UploadContentType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'audio/wav': 'wav',
};

/** Where an upload's bytes go: `<company>/<purpose>/<file id>.<extension>`. */
export function uploadKey(
  entityId: number,
  purpose: FilePurpose,
  fileId: string,
  contentType: UploadContentType,
): string {
  return `${String(entityId)}/${purpose}/${fileId}.${EXTENSIONS[contentType]}`;
}
