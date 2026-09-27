# Spike: Supabase Realtime with BOS-signed tokens

**Status:** ready to run on the hosted dev project. The BOS side is built and tested locally; nothing has run against Supabase yet.
**Design:** `docs/design/backend-weeks-3-5.md` §2.5 · **Decision:** ADR 0003 · **Audit:** M1, M15 · **Fallback:** polling every 10 s for notifications (blueprint risk 15).

## 1. What is built
| Piece | Where |
|---|---|
| ES256 keys from `BOS_JWT_CURRENT_KEY` and `BOS_JWT_NEXT_KEY` (private P-256 JWK JSON, `kid` from the key or its RFC 7638 thumbprint), parsed on first use, never at import | `apps/web/src/realtime/keys.ts` |
| Token minting: `sub`, `entity_ids` (the principal's, narrowed by the entity switcher), `bos_role`, `role: authenticated`, `aud: shakti-realtime`, `iss` = origin of `BETTER_AUTH_URL`, `iat`, `exp` = `iat` + 15 min at most, `jti`; header `alg: ES256`, `kid`, `typ: JWT` | `apps/web/src/realtime/token.ts` |
| `POST /api/v1/realtime/token`: signed-in person only (`currentPrincipal()`), another site's origin refused, agents and people with no entity in scope refused, `no-store`; answers the token, its expiry and the channels it opens; error envelope with `unauthorized` (401, with `totp_required` when the authenticator app is missing), `forbidden` (403), `integration_unavailable` (503, keys or issuer missing or broken), `internal` (500) | `apps/web/src/app/api/v1/realtime/token/route.ts`, `apps/web/src/realtime/handlers.ts` |
| `GET /.well-known/openid-configuration` (cached 1 h) and `GET /.well-known/jwks.json` (current then next public key, cached 5 min) | `apps/web/src/app/.well-known/*` |
| Shapes: `RealtimeClaims` (strict; `bos_role` a staff role, at least one entity, life of 15 minutes at most), `RealtimeTokenResponse` (`token`, `expiresAt`, `channels`), `JwksResponse`, `OpenIdConfiguration`; field names match the published contracts on the contracts branch, which replace them at integration | `apps/web/src/realtime/claims.ts` |
| Key generator (stdout only) | `pnpm --silent --filter web realtime-keys` |
| `realtime.messages` policies for `user:{id}`, `entity:{id}:queue`, `entity:{id}:board` (listen only) | `docs/spikes/realtime/realtime-policies.sql` (not a migration) |
| A spike-only policy that lets a token send on its own user channel, for the broadcast timing | `docs/spikes/realtime/spike-only-latency.sql` |
| The spike script | `pnpm --filter web realtime-spike` (`apps/web/scripts/realtime-spike.ts`; refuses to run when `CI` is set) |

Tested locally: unit tests `apps/web/src/realtime/*.test.ts` (signing and verification against the published key list, rotation, claims, 15-minute cap, expiry, wrong issuer, wrong audience, unpublished key, refusal without a session, refusal of agents and of another origin, missing or broken keys) and the security-suite test `apps/web/tests/realtime-token.test.ts` (a real Better Auth session on Postgres resolved to the token's `sub`, `entity_ids` and `bos_role`; the entity switcher narrows `entity_ids`; signed-out and missing sessions refused; an Executive without an authenticator app refused).

## 2. What the user supplies
1. A hosted **Supabase dev project** (Mumbai) with the Data API switched off, or exposing no schema (DEPLOY §1.1).
2. A **public https deployment of this branch** (a Vercel preview is enough) with `BETTER_AUTH_URL` set to its address and `BOS_JWT_CURRENT_KEY` set. Supabase must be able to fetch `https://<deployment>/.well-known/openid-configuration`; a Vercel preview behind deployment protection is not reachable, so switch protection off for that preview or use a custom domain.
3. For the script, on the machine that runs it: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the project's publishable key; never the service role key), `BETTER_AUTH_URL` and `BOS_JWT_CURRENT_KEY` with the **same values as the deployment**, `REALTIME_SPIKE_USER_ID` (any UUIDv7, ideally a real user id), `REALTIME_SPIKE_ENTITY_ID` (in scope, for example `1`), `REALTIME_SPIKE_OTHER_ENTITY_ID` (out of scope, for example `2`) and optionally `REALTIME_SPIKE_ROUNDS` (default 20).

## 3. Steps
1. Make the key: `pnpm --silent --filter web realtime-keys` and paste the one line straight into the deployment's `BOS_JWT_CURRENT_KEY` (and the local shell that runs the script). Redeploy.
2. Check the deployment: `https://<deployment>/.well-known/jwks.json` lists one key whose `kid` matches the stderr line of step 1; `/.well-known/openid-configuration` names the deployment as `issuer`.
3. In Supabase, Authentication › Third-party auth: add the BOS as a provider with the issuer `https://<deployment>` (Supabase reads the discovery document and the key list from it). If the dashboard offers only named vendors and no custom OIDC issuer for this project, stop here and record it (see §6).
4. SQL editor: run `docs/spikes/realtime/realtime-policies.sql`, then `docs/spikes/realtime/spike-only-latency.sql`. Run the checks at the bottom of the first file.
5. In Realtime settings, switch off "Allow public access" so every channel is private.
6. Run `pnpm --filter web realtime-spike`. It prints PASS or FAIL per check on stderr and a JSON report on stdout; save the report under `docs/spikes/realtime/` with the date.
7. Drop the spike-only policy: `drop policy bos_spike_self_send on realtime.messages;`.
8. Record the results in §7 and set the status line.

## 4. Pass criteria (design §2.5)
- User A joins `user:{A}`, `entity:{e}:queue` and `entity:{e}:board` for an entity in the token.
- User A is refused `user:{B}` and `entity:{other}:queue`.
- A token with another audience, an expired token and a token signed by an unpublished key (under the published `kid`) are refused on every channel.
- The Data API refuses the token (`/rest/v1/`, `/rest/v1/entities`, `/rest/v1/users` answer 4xx).
- Latency recorded: join p50 and p95, broadcast round trip p50 and p95. The spike records them; there is no target in the design beyond "usable for screen refreshes", so a join p95 above 1 s or a broadcast p95 above 500 ms from Mumbai is flagged for review rather than failed.

## 5. Key rotation (every 6 months, ADR 0003)
The key list carries two slots. Tokens live 15 minutes; the key list is cached for 5 minutes by relying parties.
1. `realtime-keys` → set as `BOS_JWT_NEXT_KEY`, redeploy. Check `/.well-known/jwks.json` lists both.
2. Wait at least 10 minutes (the list's cache and Supabase's own), then swap: the new key into `BOS_JWT_CURRENT_KEY`, the old one into `BOS_JWT_NEXT_KEY`; redeploy. New tokens carry the new `kid`; old tokens still verify.
3. Wait at least 30 minutes, clear `BOS_JWT_NEXT_KEY`, redeploy.
The unit test "survives a rotation" in `apps/web/src/realtime/token.test.ts` walks these three steps.

## 6. Known risks to settle in the run
- **Custom issuer support.** Supabase's third-party auth lists named vendors; whether a project can trust an arbitrary OIDC issuer must be confirmed in the dashboard at step 3. If it cannot, the options are: (a) import the BOS public key into the project's JWT signing keys as a trusted standby key, if the project's key settings allow a public-key import; (b) the polling fallback. Record which one was used.
- **`role` claim.** The token sets `role: authenticated` on purpose (AUDIT M15); the Data API check proves it opens nothing.
- **Presence and sending.** The policies allow listening only. Server-side broadcasts come from the notify worker after commit (ADR 0005), built in Phase 1.

## 7. Results
Not run yet.
