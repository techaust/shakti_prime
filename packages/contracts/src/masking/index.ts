// `@shakti/contracts/masking`: the pure masking every model call, log line, audit row and Sentry
// event passes through (SECURITY §5 and §6, AGENTS §9), with no import beyond its own modules, so
// the domain, the voice worker and the field app (which may not import the domain) mask alike
// (SECURITY §3.4). The contracts' index
// does not re-export it: pages and components never load it (an import fence holds that).
export * from './identity-numbers';
export * from './model-text';
export * from './number-shapes';
export * from './redact-text';
export * from './redaction';
export * from './verhoeff';
