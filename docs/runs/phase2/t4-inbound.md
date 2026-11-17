# T4 Inbound calls and screen-pop (wave 3)

| | |
|---|---|
| Branch | `feat/t4-inbound` on GitHub, from `main` at 9b6ea163 |
| Worktree | `t4-inbound`, slot 4 (Postgres 54334, app 3034), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 17-11-2026, a cloud day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)): a webhook worker, notifications, a platform write path |
| Usage | build Opus 5.5 high; 5-hour window 1 % at 12:40 UTC (the owner's reading) |
| State | building |
| Next step | the builder's early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §7.4](../../03-roadmap-appendix/phase2.md#74-t4-inbound-calls-and-screen-pop), §2 (question 4 (a): screen-pop on Realtime's `user:{id}` channel once the Realtime spike passes on `shaktiprime.com`, with a 3-second poll of a Redis-only route until then), §3 (T4 owns the screen-pop in the app shell, not the workspaces), §5.1 (P5's notes 8: Exotel's Passthru calls with GET and the call's fields in the address; `/webhooks/exotel/incoming/:secret` takes GET and POST; its event id is `CallSid`), §14, §15 (Exotel incoming signs nothing; a secret path segment).
- Built (P5, T3, I1, E1): [p5-webhooks.md](p5-webhooks.md) (the handler registry `apps/web/src/workers/webhooks/registry.ts`, where `exotel_incoming` has no handler yet; `packages/contracts/src/api/webhooks-exotel.ts`), [t3-dial.md](t3-dial.md) (`provider_calls`, the platform's `calls.process` definers in `packages/domain/src/commands/calls/provider-calls.ts`, `exotel-status.ts`, `caller_profiles.dial_phone_e164`), [i1-ingest.md](i1-ingest.md) (`crm.lead.ingest` as the platform with `crm.ingest.run`, the owner by weighted round-robin), [e1-channels.md](e1-channels.md) (`entity_channels` and its series: `ivr`, `missed_call`; calling hours and `checkDial`); the Realtime token and claims `apps/web/src/realtime/`; notifications; the Redis client; the app shell `apps/web/src/app/(bos)/layout.tsx`.
- PRD TEL-05, CRM-01 (IVR and missed calls); SECURITY §3.3 (ADR 0020), §7; API §3.4.
- Skills: `add-command`, `add-table` (if you add a table), `vercel-react-best-practices`.

Build, in this order:
1. **Platform writes:** through T3's `calls.process` definers (extend them; never a new direct write): record an inbound `provider_calls` row (series `ivr` or `missed_call` by the number dialled, idempotent by `CallSid`); match the caller's number to the company's customers (none, one or several; never another company's); find the answering caller from `DialWhomNumber` (`caller_profiles.dial_phone_e164`, the company's callers only). Keep every grant and every function body of `main`'s latest definitions when you redefine; `app.platform_only_permissions()` keeps every key.
2. **Contract and events:** `calls.inbound.ringing` (ids only: the call, the person, the matched customer ids or none) and `calls.missed.recorded` in the event catalogue; the screen-pop DTO (customer ids and display names the person may read, the number masked as the app masks it). The handler `exotel_incoming` on P5's registry (GET and POST, the secret path segment checked in constant time by P5's route).
3. **Missed calls:** a call to the missed-call number makes or attaches the lead through I1's `crm.lead.ingest` (channel `missed_call`) and a callback task due now for its owner, inside calling hours, else at the next opening; the `missed_call` notice. A repeated `CallSid` changes nothing.
4. **Tests on real Postgres:** matching one, several and no customers; another company's customer never matched; a repeated delivery; the missed-call task inside and outside hours; the platform never reads a customer through a person's grant (ADR 0020); denied, wrong-company and happy-path cases for every command touched; the agent refusal sweep.

**Early check (Tier B):** once steps 1 to 4 are committed with their tests, write a short report here, commit it with the subject `report: t4-inbound early check`, push and stop. The lead reads that diff and starts you again for steps 5 to 8.

5. **Screen-pop:** a shell component for callers who are present (signed in, in a calling role, the page visible) that opens the matched customer's Account 360, a list when several customers share the number, or the new-lead form with the number filled in. Transport: a 3-second poll of a Redis-only route (`/api/v1/calls/ringing`, the person's own pending pop, read once and cleared; no database read on the poll) is the transport in use; the Realtime `user:{id}` path is built behind the same component and switched on by one setting once the Realtime spike passes on `shaktiprime.com` (the spike is a hosted measurement for the owner; you only build the path and test it with a fake channel). The poll stops when the page is hidden and backs off on errors. The JavaScript budget holds on every page (the shell is on all of them).
6. **Screens and copy:** the pop, the several-customers list, the prefilled new-lead form; copy in `en.json` (plain words: "Incoming call", never "IVR" or a code); journeys with axe and light, dark and 400 px snapshots, the ringing simulated through a test-only seam (as T3's fake Exotel), never on a production build.
7. **Measure:** the pop within 2 seconds of the Passthru call on the local stack (record the number in your report; the dev-deployment figure is G2's).
8. **Documents:** DATABASE, SECURITY §3.3, API, the design's "Built (T4)" under §7.4, `pnpm db:docs`, `machines:docs` if a machine changes.

Files owned: the `exotel_incoming` handler, inbound and missed-call platform writes, `calls.inbound.ringing` and `calls.missed.recorded`, the ringing route, the screen-pop component and its mount in the app shell. Shared registration points (one line each, merged by the lead): the event catalogue and worker registry, the webhook handler registry, `en.json`, the testing lists, `turbo.json` and `.env.example` (any new variable), notification kinds.

Built beside you, do not touch: A2 owns the Co-pilot panel in `/calling` and `/converting` and reads `provider_calls` (do not change existing columns' meaning); S3 and A3 own the WhatsApp paths; V2 owns `apps/voice-agent`, `/voice` and its menu line. Your migrations are numbered after `main`'s last (0188) and renumbered by the lead at merge.

Review checklist (check before your report): the incoming route accepts nothing without the secret and stores nothing twice; a pop never shows a customer the person may not read, nor another company's; the poll reads no database and leaks nothing between people; a missed-call task lands inside calling hours; the platform writes only through definers checking `calls.process` or `crm.ingest.run`; no number shown unmasked where the app masks it.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §7.4 pass on the local stack; `pnpm test:security` passes on your Postgres.

Not in T4: the Realtime spike on production and the dev-deployment timing (G2 and the owner); the live IVR and missed-call numbers (final phase).

## Report

## Review

## Integration
