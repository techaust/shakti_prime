# T3 Click-to-dial and recordings (wave 2)

| | |
|---|---|
| Branch | `feat/t3-dial` on GitHub, from `main` at 27662a00 |
| Worktree | `t3-dial`, slot 3 (Postgres 54333, app 3033), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 14-11-2026, a cloud day) |
| Tier | A ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high; 5-hour window 0 % at 07:00 UTC (the owner's reading) |
| State | building |
| Next step | the builder's early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §6.3](../../03-roadmap-appendix/phase2.md#63-t3-click-to-dial-and-recordings), §2 (question 13), §3 (wave 2 file ownership), §4 (`calls.dial` and `calls.recording.listen` already in the catalogue and seed, first used here; platform-only `calls.process`), §11 (`calling` and `retention.callRecordingMonths`), §14 and §15 (provider calls).
- Built (P5) and (E1) in §5.1 and §5.2: the `exotel_status` route and `EXOTEL_CALLBACK_SECRET`, the empty handler registry `apps/web/src/workers/webhooks/registry.ts`; `entity_channels`, `app.dial_facts()`, `call-purpose.ts`, `checkDial`, `planDial` and `prepareDial` (`packages/domain/src/telecom`), the workspaces' plan of a call (`planCall`).
- `docs/04-architecture-appendix/exotel.md` and `calling.md`; BLUEPRINT §7.6 and §7.9; PRD TEL-01, TEL-04; SECURITY §3.2 and §3.3; ADR 0020.
- What exists: the Exotel client and status-callback parser (`apps/web/src/integrations/exotel/`), `calls` and `calls.log` (written once by the person's log), `caller_profiles` (`packages/domain/src/commands/crm/caller-profiles.ts`; it has no `dial_phone_e164` yet, you add it), the file store with KMS (`apps/web/src/files`), the nightly route and retention runs, the voice-prompt templates in `packages/contracts/src/templates`.
- Skills: `add-table`, `add-command`.

Build, in this order:
1. **Table `provider_calls`** as §6.3 says, read with the lead, a status only moving forward (guard trigger), `provider_call_sid` unique; RLS, the testing lists, fixture rows, the role × company matrix (AGENTS §6). `caller_profiles.dial_phone_e164`, set by the caller on their own profile.
2. **Permission** platform-only `calls.process` of `system:workers` (catalogue, scopes, `SYSTEM_MATRIX`, seed, SECURITY §3.2 and §3.3, the oracle case); `app.platform_only_permissions()` keeps every key of `main`'s latest and adds yours. Seed rows and SECURITY §3.2 lines for `calls.dial` and `calls.recording.listen` if either lacks one.
3. **Commands** `calls.call.dial` (people, `calls.dial`: `app.dial_facts()`, E1's purpose and `checkDial`; records `dialling`, then places the call through the client from the caller's phone to the customer's, with the company's number for the purpose as caller id, recording on and the signed status address; a refused dial reaches no vendor and lists every reason); `calls.call.log` gains an optional `providerCallId` (start and duration then come from the provider call); `calls.recording.play` (`calls.recording.listen`; a 15-minute address, each listen audited); the platform's status record, recording copy and delete through definers checking `calls.process`. The client sits behind a port so tests use a fake transport. Denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep.

**Early check (Tier A):** once steps 1 to 3 are committed with their tests, write a short report here, commit it with the subject `report: t3-dial early check`, push and stop. The lead reads that diff and starts you again for steps 4 to 8.

4. **Handler** `exotel_status` on P5's registry: match the signed reference and the CallSid, record the status as the platform, copy the recording from `RecordingUrl` with the account's key into a `call_recording` file (KMS; the link is never kept), emit `calls.dial.completed` with ids. The nightly sweep deletes recordings older than `WORKSHOP_DEFAULTS.retention.callRecordingMonths` (12) and keeps the row.
5. **The recording notice:** the company's Exotel flow plays it before the caller is joined; the Hinglish wording is a voice prompt in `packages/contracts/src/templates` (`WORKSHOP_DEFAULTS.calling` names it, LAW-3). If the client cannot attach a flow to a click-to-dial call (read `exotel.md` and the client), record that in your report; the call is then placed unrecorded and the script card's first line is the notice to read.
6. **Screens:** the Dial key (`C`) in the Cold Caller and Converting workspaces where the company has numbers, in a call-bar component of your own (ringing, connected, time, ended) with one mount line in each page (W1 adds its thread component to `/converting` in its own component); the log form filled with the time; the manual flow stays for a company without numbers; the caller's own dial phone on their profile; Play recording on the call's timeline row. Copy in `en.json`; journeys with axe on a fake Exotel, light, dark and 400 px snapshots; the JavaScript budget.
7. **Tests** of §14: refusals never reach the client (a fake transport that fails on any call); forward-only status; a repeated or late callback changes nothing back; recording copy and the 12-month sweep; listening only with the permission, each listen audited; the Dial journey; `EXPLAIN (ANALYZE)` for every list.
8. **Documents:** DATABASE (and why `provider_calls` is its own table), SECURITY §3.2 and §3.3, API §6, `docs/runbooks/` line for an Exotel outage (the manual flow), the design's "Built (T3)" under §6.3, `pnpm db:docs`, `machines:docs` if a machine changes.

Files owned: everything above, the Dial key and call bar, `calls.call.dial`, `calls.recording.play`, the `providerCallId` change to `calls.call.log`. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, `nav.ts`, the testing lists, the event catalogue and worker registry, the webhook handler registry, `turbo.json` and `.env.example`, `WORKSHOP_DEFAULTS`. W1, I1, K3 and B1 build beside you: never touch `apps/web/src/screens/messaging`, the WhatsApp or Lead Ads handlers, `crm.lead.create` or `crm.lead.ingest`, the knowledge index job or `packages/domain/src/ai/ask`. E1's `telecom/` rules are read, not changed; if a rule needs changing, stop and report.

Review checklist (check before your report): no path reaches Exotel without `checkDial` passing (outside hours, DND without consent, an opted-out contact, a missing or wrong-series number); the caller's phone and the customer's never logged; the recording link never stored; a recording read only through `calls.recording.play` with the permission, audited; the platform's writes only through definers checking `calls.process`; a status never moves back.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §6.3 pass; `pnpm test:security` passes on your Postgres.

Not in T3: inbound calls, missed calls and the screen-pop (T4); transcription and the Co-pilot (A2); the DLT numbers (final phase).

## Report
