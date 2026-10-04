import { MAX_UPLOAD_BYTES, type FilePurpose, type UploadContentType } from '@shakti/contracts';

/** What an upload of a purpose may be: its types and its largest size. */
export interface UploadLimit {
  contentTypes: readonly UploadContentType[];
  maxBytes: number;
}

const IMAGES: readonly UploadContentType[] = ['image/jpeg', 'image/png', 'image/webp'];
const IMAGES_AND_PDF: readonly UploadContentType[] = [...IMAGES, 'application/pdf'];
const MB = 1024 * 1024;

/**
 * Limits per purpose (docs/SECURITY.md §8), checked by `files.upload.begin` and by the uploader
 * before any byte is sent. A logo and a letterhead are images, because documents print them as
 * pictures; a quote's PDF is a PDF; a signed quote, consent evidence or vault file may be a photo
 * or a scan. The vault's Word and Excel files arrive with K1.
 */
export const UPLOAD_LIMITS: Readonly<Partial<Record<FilePurpose, UploadLimit>>> = {
  quote_pdf: { contentTypes: ['application/pdf'], maxBytes: 10 * MB },
  signed_quote: { contentTypes: IMAGES_AND_PDF, maxBytes: MAX_UPLOAD_BYTES },
  entity_logo: { contentTypes: IMAGES, maxBytes: 2 * MB },
  letterhead: { contentTypes: IMAGES, maxBytes: 5 * MB },
  print_proof: { contentTypes: ['application/pdf'], maxBytes: 10 * MB },
  knowledge: { contentTypes: IMAGES_AND_PDF, maxBytes: MAX_UPLOAD_BYTES },
  consent_evidence: { contentTypes: IMAGES_AND_PDF, maxBytes: MAX_UPLOAD_BYTES },
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
  return size > limit.maxBytes ? 'file_too_large' : undefined;
}

/** The file name extension the store's key carries for a type. */
export const EXTENSIONS: Readonly<Record<UploadContentType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
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
