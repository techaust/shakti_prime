/**
 * The largest form a server action, or the proxy in front of it, accepts: an import file of
 * `IMPORT_LIMITS.maxFileBytes` (10 MB) and the form fields around it. `next.config.ts` reads it,
 * so it imports nothing; `limits.test.ts` keeps it above the import limit and the two forms equal.
 */
export const UPLOAD_BODY_LIMIT = '11mb';
export const UPLOAD_BODY_LIMIT_BYTES = 11 * 1024 * 1024;
