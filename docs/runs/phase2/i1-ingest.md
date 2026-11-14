# I1 Lead Ads, lead forms and website ingest (wave 2)

| | |
|---|---|
| Branch | `feat/i1-ingest` on GitHub, from `main` at 27662a00 |
| Worktree | `i1-ingest`, slot 1 (Postgres 54331, app 3031), in the lead's cloud VM |
| Runs on | the lead's cloud session (owner, 14-11-2026, a cloud day) |
| Tier | B ([models-and-usage §2](../../runbooks/models-and-usage.md#2-slice-tiers)) |
| Usage | build Opus 5.5 high; 5-hour window 0 % at 07:00 UTC (the owner's reading); VM 14,778 MB available, load 1.66 of 4 at the start |
| State | building |
| Next step | the builder's early check |

## Brief
Read first:
- Design: [`docs/03-roadmap-appendix/phase2.md` §6.2](../../03-roadmap-appendix/phase2.md#62-i1-lead-ads-lead-forms-and-website-ingest), §2 (question 3: the owner of a lead from an integration is T2's weighted round-robin among the company's present Cold Calling Tele-Callers, else routed work for the Sales Team Lead; question 13: production's vendor variables stay unset), §3 (wave 2 file ownership), §4 (`crm.sources.write`, platform-only `crm.ingest.run`), §11, §14 and §15 (Lead Ads consent).
- Built (P5) in §5.1: the webhook routes, `webhook_inbox`, the worker `/workers/webhooks/process` and the empty handler registry `apps/web/src/workers/webhooks/registry.ts`; `META_LEADGEN_APP_SECRET`, `META_LEADGEN_VERIFY_TOKEN`, `GOOGLE_LEADFORM_KEY`. The website contract `packages/contracts/src/api/ingest.ts` (built).
- BLUEPRINT §7.7; PRD CRM-01 and CRM-02; API §3.4 and §6; SECURITY §3.2, §3.3 and ADR 0020 (platform-only grants through narrow definers); ADR 0008 (customers shared through `account_entities`).
- What exists: `crm.lead.create` (`packages/domain/src/commands/crm/create-lead.ts`: normalisation, PIN lookup, dedupe, attach to an open lead, routing a colleague's customer); `lead-attribution.ts`; `consent.ts`; T2's picker; the `FieldCipher` (`apps/web/src/crypto`); `RECORDED_STAGE_EXIT_FIELDS`.
- Skills: `add-table`, `add-command`.

Build, in this order:
1. **Tables** `lead_sources`, `ingest_keys` and `lead_qualifications` as §6.2 says, with RLS by company (`lead_qualifications` read and written with its lead's rule), the testing lists, fixture rows, the role × company matrix (AGENTS §6). `page_token_sealed` is never read back by a request role.
2. **Permissions** `crm.sources.write` (Executive, all) and the platform-only `crm.ingest.run` of `system:workers` (catalogue, scopes, `SYSTEM_MATRIX`, seed, SECURITY §3.2 and §3.3, the oracle case). `app.platform_only_permissions()` keeps every key of `main`'s latest version and adds yours.
3. **`crm.lead.ingest`** (platform, `crm.ingest.run`): the same normalisation, PIN lookup, dedupe, attach-to-open-lead and routing as `crm.lead.create`, through definers that check the grant, with the channel, the provider ids as attribution, a consent only when the form's mapped consent question was ticked (with its text version), and the owner of question 3. Factor the shared steps out of `create-lead.ts` rather than copy them; you own that file in wave 2. **Its input contract is used by W1** (channel `whatsapp`, the click-to-WhatsApp `referral` with `ctwa_clid` as attribution, no consent): export it from `packages/contracts` and commit it first, in its own commit with the subject `feat(contracts): crm.lead.ingest input`, and push.
4. **Commands** `crm.lead.qualification.set` (people with `crm.lead.write`; agents may propose later), `crm.source.set`, `crm.source.archive`, `crm.ingest_key.create` (the key shown once, stored as a hash), `crm.ingest_key.revoke` (`crm.sources.write`); the qualification facts join `RECORDED_STAGE_EXIT_FIELDS`. Denied, wrong-company and happy-path tests on real Postgres; the agent refusal sweep.
5. **Handlers** on P5's registry: `meta_leadgen` (fetch `GET /<leadgen_id>` with the source's Page token through a client in `apps/web/src/integrations/meta-leadgen/`, parse, map by `field_map_json`, ingest), `google_leadform` (`is_test` stored, no lead made); an unmapped form is stored and reported on Integration health, never guessed. The website route `POST /api/v1/ingest/leads` (key from `X-Ingest-Key` by its hash, Turnstile, 60 a minute per key, ingested in the request) and `GET /api/v1/ingest/health`. Recorded payloads in fixtures; contract tests including repeats.
6. **Screens:** Settings › Lead sources (`crm.sources.write`): sources per company, the field map with a preview from the newest test lead, keys (create shows the key once, revoke); the qualification card on the lead sheet (board, Converting workspace, Account 360's lead). Copy in `en.json`; journeys with axe; the JavaScript budget.
7. **Tests** of §14: each provider's recorded lead becomes a lead within 10 seconds on the in-process path, with source, company, attribution and consent; a repeated event creates nothing; an unmapped form; a revoked key and a failed Turnstile refused; `EXPLAIN (ANALYZE)` for every list.
8. **Documents:** DATABASE, SECURITY §3.2 and §3.3, API §6, the design's "Built (I1)" under §6.2, `pnpm db:docs`, `machines:docs` if a machine changes.

Files owned: everything above, `create-lead.ts` and its shared steps, `crm.lead.ingest`, `crm.lead.qualification.set` and the qualification card. Shared registration points (one line each, merged by the lead): the permission catalogue and seed, `en.json`, `nav.ts`, the testing lists, the event catalogue and worker registry, the webhook handler registry (one entry per handler), `turbo.json` and `.env.example`, `WORKSHOP_DEFAULTS`. W1, T3, K3 and B1 build beside you: never touch the WhatsApp handler, `apps/web/src/screens/messaging`, the Dial key or call bar, `provider_calls`, the knowledge index job or `packages/domain/src/ai/ask`.

**Early check (Tier B):** once the tables, permissions, `crm.lead.ingest` and the other commands are committed with their tests, write a short report here, commit it with the subject `report: i1-ingest early check`, push and stop. The lead reads that diff and starts you again for the handlers, the route and the screens.

Review checklist (check before your report): every new table in the testing lists with a fixture row per company and its matrix rule; `crm.lead.ingest` reachable only by `system:workers` through definers; no Page token, ingest key or Turnstile secret logged, returned or audited; a consent recorded only from a ticked mapped question; no lead from a Google test lead; the website route rate-limited and Turnstile-checked before any write.

Done when: AGENTS §10 holds on the branch; the acceptance lines of §6.2 pass; `pnpm test:security` passes on your Postgres.

Not in I1: the companies' real Pages, forms and keys (final phase); the WhatsApp handler (W1, which calls your `crm.lead.ingest`); inbound calls and missed calls (T4).

## Report
