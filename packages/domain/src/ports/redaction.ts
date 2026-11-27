// The field rules of the logs, the audit trail and Sentry live in `@shakti/contracts/masking`
// (`redaction.ts`), where the field app, which may not import the domain, uses them too; this
// module keeps the domain's import path (`@shakti/domain/redaction`, `./logger`).
export {
  CODE_KEYS,
  fieldKind,
  IDENTITY_KEYS,
  isCodeKey,
  isLongNumber,
  isMeasureKey,
  keepsAsCode,
  normaliseKey,
  redact,
  redactError,
  redactText,
  scrubValue,
  type FieldKind,
} from '@shakti/contracts/masking';
