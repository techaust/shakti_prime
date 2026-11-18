// `@shakti/contracts/masking`: the pure text masking every model call and log line passes through
// (SECURITY §5 and §6, AGENTS §9), with no import beyond its own modules, so the domain and the
// voice worker (which may not import the domain) mask alike (SECURITY §3.4). The contracts' index
// does not re-export it: pages and components never load it (an import fence holds that).
export * from './identity-numbers';
export * from './model-text';
export * from './number-shapes';
export * from './redact-text';
export * from './verhoeff';
