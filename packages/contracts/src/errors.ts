import { z } from 'zod';

/** Stable error codes (docs/API.md §1). Users never see these; the catalogue maps each to a sentence. */
export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'integration_unavailable',
  'internal',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  integration_unavailable: 503,
  internal: 500,
};

/**
 * The one error type thrown by the domain layer. `message` is for logs and developers only;
 * user-facing text comes from the message catalogue keyed by `code`.
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  /** `cause` keeps the original failure for the logs (AUDIT M35); it never reaches a user. */
  constructor(
    code: ErrorCode,
    message?: string,
    details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
