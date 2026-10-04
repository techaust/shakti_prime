# ADR 0015 — Sentry in the group's US-region organisation, with personal data removed before sending

**Status:** Accepted (owner, 28-09-2026) · **Date:** 28-09-2026 · **Blueprint:** §5, §7.5, §12 · **Architecture:** §12 · **Security:** §5, §8 · **Design:** `docs/design/phase1.md` §5.2 · **ADR:** 0014

## Context
Phase 1 needs error reports from the web app's server, edge and browser code, and an alert when the outbox publisher keeps failing (ROADMAP §3). The group already runs a Sentry organisation in Sentry's US region; the alternative was a new organisation for the BOS alone. Any error report can carry a URL, a header, a form value or a log line, and under the DPDP Act (blueprint §7.5) customer phone numbers, Aadhaar digits, bank details and message bodies must not leave the BOS for a vendor that has no need of them.

## Decision
**Use the group's existing US-region Sentry organisation for the web app, and remove personal data in the app before any event is sent.**

- `@sentry/nextjs` starts on the server and the edge in `apps/web/src/instrumentation.ts`, and in the browser through a small loader that fetches the SDK when the page is first idle, so no page's first load carries it. Without `SENTRY_DSN` (or `NEXT_PUBLIC_SENTRY_DSN` in the browser) nothing is started or fetched.
- `sendDefaultPii` is off (`apps/web/src/observability/sentry-options.ts`). Every event, transaction and breadcrumb passes `apps/web/src/observability/sentry-scrub.ts` in `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`: the logger's redaction (`@shakti/domain/redaction`), no cookie, header, query string or body, the person named by principal id only, and the principal and request ids as the only tags (`KEPT_TAGS`).
- `release` is the commit and `environment` is `BOS_ENVIRONMENT`; source maps are uploaded at build time only with `SENTRY_AUTH_TOKEN`.
- The outbox reports `outbox.dead_lettered` and `outbox.publisher_failing` with counts and ids only (`apps/web/src/observability/alerts.ts`); an alert rule in Sentry mails the owner.
- The project's own settings add a second layer that the app cannot set: Sentry's server-side data scrubbing and "prevent storing of IP addresses", which the owner switches on in the project settings. The app's own scrubbing does not depend on them.

## Consequences
- One Sentry organisation for the group's error tracking.
- Reports are stored in the US. What they hold is limited to stack traces, routes without query strings, principal ids, request ids and redacted text, so no customer's personal data is transferred; `sentry-scrub.test.ts` holds the rule.
- A field the redaction does not know could still reach Sentry inside an exception message; the logger's redaction tests and the scrub tests are the guard, and a new identity field joins the redaction list when it is added.
- The field app, the Tally connector and the voice worker join Sentry under the same rules with their phases.
- Sentry is one of the vendors SECURITY §5 lists.
