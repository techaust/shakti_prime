# ADR 0003 — Better Auth over Supabase Auth, with BOS-signed JWTs for Realtime

**Status:** Accepted · **Date:** 2026-09-26 · **Blueprint:** §5, §7.3 · **Architecture:** §4, §8 · **Security:** §2 · **API:** §2

## Context
Staff identity needs Argon2id passwords, database sessions with idle and absolute timeouts, TOTP for Executive, GM and Accounts, Turnstile, per-IP and per-account lockouts, forced logout and session revocation on role change, plus device-bound refresh tokens for the Android app and short-lived user-scoped tokens for the voice agent. The database is Supabase, and Supabase Realtime authorises private channels with JWT claims. Supabase Auth would couple identity to the Supabase project, expose a Data API role in its tokens and make the session model harder to shape to these rules.

## Decision
**Better Auth** owns identity and sessions; the BOS **signs its own ES256 JWTs** for Supabase Realtime.

- Better Auth with Argon2id (m = 64 MiB, t = 3, p = 1), database sessions stored in `sessions`, rotation on privilege change, 12-hour idle and 7-day absolute timeouts, TOTP plugin for the three privileged roles, recovery codes, Cloudflare Turnstile on login, Redis-backed exponential lockouts.
- Cookies are `__Host-` prefixed, HttpOnly, Secure, SameSite=Lax; server actions check the request origin.
- Mobile: 15-minute access tokens and rotating refresh tokens bound to the device; per-device revocation. Voice: 5-minute tokens scoped to the speaking user.
- Realtime: `POST /api/v1/realtime/token` mints an ES256 JWT (`sub`, `entity_ids`, `role`, `exp` ≤ 15 minutes) from a BOS key pair. The BOS publishes an OIDC discovery document and JWKS on `shaktiprime.com`; Supabase is configured to trust it as a third-party auth provider. Realtime authorization policies on `realtime.messages` read those claims. The token carries no Data API role, so it grants Realtime only.
- Broadcasts are sent after commit through the outbox and a notify worker, never before the write is durable.

## Consequences
- Session rules, 2FA policy and lockouts are expressed in application code and tested with the rest of the domain, independent of the Supabase project.
- Every data path still goes through `withRequestContext()` and commands; the Realtime token cannot be used to read tables.
- The Phase 0 Realtime spike must prove the third-party JWT registration end to end; the fallback if it fails is polling for notifications (blueprint risk 15).
- Key management for the ES256 pair (rotation every 6 months, JWKS with the current and next key) is part of the secret-rotation runbook.
- Password reset and 2FA recovery mail go through Amazon SES only.
