import type { UploadContentType } from '@shakti/contracts';
import { UPLOAD_CONTENT_TYPES } from './contract-values';

// Upload helpers the screens share, safe for the browser (types only from the contracts).

/** Each upload type's key under `files.types` (its name) and `files.shortTypes`. */
export const FILE_TYPE_KEYS = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
} as const satisfies Record<UploadContentType, string>;
export type FileTypeKey = (typeof FILE_TYPE_KEYS)[UploadContentType];

export function fileTypeKey(type: string): FileTypeKey | undefined {
  return (UPLOAD_CONTENT_TYPES as readonly string[]).includes(type)
    ? FILE_TYPE_KEYS[type as UploadContentType]
    : undefined;
}

/**
 * The scanner's own verdicts (GuardDuty Malware Protection for S3's `GuardDutyMalwareScanStatus`
 * tag), each with its words under `files.scanStatus`.
 */
export const SCAN_STATUSES = [
  'NO_THREATS_FOUND',
  'THREATS_FOUND',
  'UNSUPPORTED',
  'ACCESS_DENIED',
  'FAILED',
] as const;

/** A size limit in whole megabytes, or kilobytes under one megabyte, for the helper text. */
export function sizeParts(bytes: number): { unit: 'mb' | 'kb'; value: number } {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? { unit: 'mb', value: Math.round(mb * 10) / 10 }
    : { unit: 'kb', value: Math.max(1, Math.round(bytes / 1024)) };
}
