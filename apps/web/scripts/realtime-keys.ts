// Prints a new ES256 signing key for BOS tokens (ADR 0003) as one line of JWK JSON on stdout, the
// value of BOS_JWT_CURRENT_KEY or BOS_JWT_NEXT_KEY. Nothing is written to disk: pipe it straight
// into the hosting provider's secret store and never commit it. The rotation steps are in
// docs/runbooks/DEPLOY.md and docs/spikes/realtime.md.
// Usage: pnpm --silent --filter web realtime-keys
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';

const { privateKey } = await generateKeyPair('ES256', { extractable: true });
const jwk = await exportJWK(privateKey);
const { kty, crv, x, y, d } = jwk;
if (kty !== 'EC' || crv !== 'P-256' || x === undefined || y === undefined || d === undefined) {
  console.error('the generated key is not a P-256 key');
  process.exit(1);
}
const kid = await calculateJwkThumbprint({ kty, crv, x, y });
process.stdout.write(`${JSON.stringify({ kty, crv, x, y, d, kid, alg: 'ES256', use: 'sig' })}\n`);
console.error(`new signing key ${kid}: the line above is private; store it only as a secret`);
