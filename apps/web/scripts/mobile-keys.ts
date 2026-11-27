// Prints a new ES256 key pair for the field app's access tokens (F1, docs/03-roadmap-appendix/
// phase4.md §6.4) as two lines of JWK JSON on stdout: first MOBILE_JWT_PRIVATE_KEY, then
// MOBILE_JWT_PUBLIC_KEY. Nothing is written to disk: put the two lines straight into the hosting
// provider's secret store and never commit them. A new pair signs every phone out at its next call
// once its access token ends, so a rotation is planned with the field team.
// Usage: pnpm --silent --filter web exec tsx scripts/mobile-keys.ts
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
process.stdout.write(`${JSON.stringify({ kty, crv, x, y, kid, alg: 'ES256', use: 'sig' })}\n`);
console.error(`new field app key pair ${kid}: the first line is private; store it only as a secret`);
